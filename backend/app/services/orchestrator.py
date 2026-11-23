"""
Main orchestration engine.
Dispatch tasks, detect stalls, escalate, reschedule with fallbacks.
All decisions are deterministic — LLM used only for notification messages.
"""
from typing import List, Optional, Tuple
from sqlmodel import Session, select
from app.domain.models import (
    Hire, Task, TaskStatus, HireStatus, OutboxItem, AuditEvent,
    Notification, Ticket, SimState, ApprovalState, TaskFlag,
)
from app.services.cpm import CPMTask, compute_cpm, get_remaining_days, is_stalled
import uuid
import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sim state helpers
# ---------------------------------------------------------------------------

def get_or_create_sim_state(session: Session) -> SimState:
    state = session.exec(select(SimState)).first()
    if not state:
        state = SimState(current_day=0, itsm_offline=False)
        session.add(state)
        session.commit()
        session.refresh(state)
    return state


def advance_day(session: Session) -> int:
    state = get_or_create_sim_state(session)
    state.current_day += 1
    session.add(state)
    session.commit()
    return state.current_day


def get_current_day(session: Session) -> int:
    return get_or_create_sim_state(session).current_day


# ---------------------------------------------------------------------------
# Audit & notify
# ---------------------------------------------------------------------------

def audit(session: Session, hire_id: int, message: str,
          level: str = "info", actor: str = "system") -> None:
    event = AuditEvent(
        day=get_current_day(session),
        hire_id=hire_id,
        level=level,
        message=message,
        actor_agent=actor,
    )
    session.add(event)
    session.commit()


def notify(session: Session, role: str, message: str,
           hire_id: Optional[int] = None, task_id: Optional[int] = None) -> None:
    n = Notification(for_role=role, message=message, hire_id=hire_id, task_id=task_id)
    session.add(n)
    session.commit()


# ---------------------------------------------------------------------------
# Idempotency key
# ---------------------------------------------------------------------------

def make_ikey(hire_id: int, task_key: str) -> str:
    return f"hire{hire_id}:{task_key}"


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def dispatch_task(session: Session, task: Task, current_day: int,
                  itsm_offline: bool = False) -> bool:
    """Create ticket for task. Returns True if dispatched, False if queued (outbox)."""
    ikey = make_ikey(task.hire_id, task.key)

    # Idempotency: never create duplicate ticket
    existing = session.exec(select(Ticket).where(Ticket.idempotency_key == ikey)).first()
    if existing:
        if task.ticket_id != existing.ticket_id:
            task.ticket_id = existing.ticket_id
            session.add(task)
            session.commit()
        return True

    if itsm_offline:
        # Queue in outbox (idempotent)
        ob = session.exec(
            select(OutboxItem).where(OutboxItem.idempotency_key == ikey)
        ).first()
        if not ob:
            ob = OutboxItem(
                hire_id=task.hire_id,
                task_id=task.id,
                idempotency_key=ikey,
                title=task.title,
                team=task.team,
                estimate_days=task.duration_days,
            )
            session.add(ob)
            task.status = TaskStatus.queued
            session.add(task)
            session.commit()
            audit(session, task.hire_id,
                  f"Task '{task.title}' queued in outbox (ITSM offline)",
                  "warning", "it_provisioner")
        return False

    # Create ticket
    ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
    ticket = Ticket(
        ticket_id=ticket_id,
        idempotency_key=ikey,
        title=task.title,
        team=task.team,
        estimate_days=task.duration_days,
        hire_id=task.hire_id,
        task_id=task.id,
        status="open",
    )
    session.add(ticket)

    task.ticket_id = ticket_id
    task.status = TaskStatus.dispatched
    task.dispatched_day = current_day
    task.last_activity_day = current_day
    session.add(task)
    session.commit()

    audit(session, task.hire_id,
          f"Ticket {ticket_id} created for '{task.title}' ({task.team})",
          "info", "supervisor")
    return True


# ---------------------------------------------------------------------------
# Outbox drain
# ---------------------------------------------------------------------------

def drain_outbox(session: Session, current_day: int) -> None:
    """Drain queued outbox items — idempotent, no duplicate tickets."""
    items = session.exec(select(OutboxItem)).all()
    for item in items:
        # Double-check idempotency
        existing = session.exec(
            select(Ticket).where(Ticket.idempotency_key == item.idempotency_key)
        ).first()
        if existing:
            session.delete(item)
            continue

        ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
        ticket = Ticket(
            ticket_id=ticket_id,
            idempotency_key=item.idempotency_key,
            title=item.title,
            team=item.team,
            estimate_days=item.estimate_days,
            hire_id=item.hire_id,
            task_id=item.task_id,
            status="open",
        )
        session.add(ticket)

        task = session.get(Task, item.task_id)
        if task:
            task.ticket_id = ticket_id
            task.status = TaskStatus.dispatched
            task.dispatched_day = current_day
            task.last_activity_day = current_day
            session.add(task)
            audit(session, item.hire_id,
                  f"Outbox recovered: ticket {ticket_id} for '{item.title}'",
                  "info", "supervisor")

        session.delete(item)
    session.commit()


# ---------------------------------------------------------------------------
# CPM
# ---------------------------------------------------------------------------

def run_cpm_for_hire(
    session: Session, hire: Hire
) -> Tuple[List[CPMTask], float]:
    """Run CPM over open tasks. Returns (cpm_tasks, min_slack)."""
    current_day = get_current_day(session)
    deadline = float(hire.start_day - current_day)

    open_statuses = [
        TaskStatus.pending, TaskStatus.queued,
        TaskStatus.dispatched, TaskStatus.awaiting_approval,
    ]
    open_tasks = session.exec(
        select(Task).where(Task.hire_id == hire.id, Task.status.in_(open_statuses))
    ).all()

    done_keys = {
        t.key
        for t in session.exec(
            select(Task).where(Task.hire_id == hire.id, Task.status == TaskStatus.done)
        ).all()
    }

    cpm_tasks = []
    for t in open_tasks:
        remaining = get_remaining_days(t.status, t.duration_days, t.dispatched_day, current_day)
        deps = [d for d in t.depends_on_list if d not in done_keys]
        cpm_tasks.append(CPMTask(key=t.key, remaining_days=remaining, deps=deps))

    if not cpm_tasks:
        return [], deadline

    computed = compute_cpm(cpm_tasks, deadline)

    # Write slack/critical back to DB
    task_map = {t.key: t for t in open_tasks}
    for ct in computed:
        if ct.key in task_map:
            task_map[ct.key].slack = ct.slack
            task_map[ct.key].critical = ct.critical
            session.add(task_map[ct.key])
    session.commit()

    min_slack = min(ct.slack for ct in computed)
    return computed, min_slack


# ---------------------------------------------------------------------------
# Stall detection & self-healing
# ---------------------------------------------------------------------------

def handle_stalls(
    session: Session, hire: Hire,
    cpm_tasks: List[CPMTask], min_slack: float,
) -> None:
    """Detect stalled tasks on critical/near-critical path; escalate + reschedule."""
    current_day = get_current_day(session)
    db_tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    task_map = {t.key: t for t in db_tasks}
    cpm_map = {ct.key: ct for ct in cpm_tasks}

    for key, task in task_map.items():
        if not is_stalled(task, current_day):
            continue
        ct = cpm_map.get(key)
        if ct is None:
            continue

        # Only act on critical or near-critical tasks (avoid alert fatigue)
        if ct.slack > min_slack + 1:
            if task.flag == TaskFlag.none:
                task.flag = TaskFlag.watch
                session.add(task)
            continue

        # Escalate
        if task.flag not in (TaskFlag.escalated, TaskFlag.rescheduled):
            task.flag = TaskFlag.escalated
            session.add(task)
            msg = (
                f"ESCALATION: '{task.title}' for {hire.name} is stalled on the critical path. "
                f"Slack={ct.slack:.1f}d. Immediate action required."
            )
            audit(session, hire.id, msg, "critical", "progress_monitor")
            notify(session, "Manager", msg, hire.id, task.id)
            notify(session, "IT",
                   f"Action needed: '{task.title}' for {hire.name} is stalled.",
                   hire.id, task.id)

        # Reschedule with fallback if available
        if task.fallback_title and task.flag != TaskFlag.rescheduled:
            old_title = task.title
            task.flag = TaskFlag.rescheduled
            task.title = task.fallback_title
            task.duration_days = task.fallback_days or 1
            task.fallback_title = None
            task.fallback_days = None
            # Reset for re-dispatch
            task.status = TaskStatus.pending
            task.dispatched_day = None
            task.ticket_id = None
            session.add(task)
            audit(session, hire.id,
                  f"RESCHEDULED: '{old_title}' → fallback '{task.title}' ({task.duration_days}d)",
                  "warning", "progress_monitor")
    session.commit()


# ---------------------------------------------------------------------------
# Readiness & status
# ---------------------------------------------------------------------------

def compute_readiness(session: Session, hire: Hire) -> float:
    all_tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    if not all_tasks:
        return 0.0
    done = sum(1 for t in all_tasks if t.status == TaskStatus.done)
    return round(done / len(all_tasks) * 100, 1)


def update_hire_status(
    session: Session, hire: Hire, min_slack: float, readiness: float
) -> None:
    hire.readiness = readiness
    all_tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    all_done = all(t.status == TaskStatus.done for t in all_tasks) if all_tasks else False

    if all_done or readiness >= 100:
        hire.status = HireStatus.ready
    elif min_slack < 0:
        hire.status = HireStatus.at_risk
    else:
        hire.status = HireStatus.on_track

    current_day = get_current_day(session)
    hire.projected_day = (
        hire.start_day + max(0, int(-min_slack)) if min_slack < 0 else hire.start_day
    )
    session.add(hire)
    session.commit()


# ---------------------------------------------------------------------------
# Monitor tick (the main scheduled loop)
# ---------------------------------------------------------------------------

def monitor_tick(session: Session) -> None:
    """
    Main monitor loop:
    1. Drain outbox if ITSM online
    2. For each hire: dispatch unblocked tasks, run CPM, detect stalls, update status
    """
    sim_state = get_or_create_sim_state(session)
    current_day = sim_state.current_day
    itsm_offline = sim_state.itsm_offline

    if not itsm_offline:
        drain_outbox(session, current_day)

    hires = session.exec(select(Hire)).all()
    for hire in hires:
        tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
        done_keys = {t.key for t in tasks if t.status == TaskStatus.done}

        for task in tasks:
            # Skip already-active tasks
            if task.status not in (TaskStatus.pending,):
                continue

            # Approval gate
            if task.needs_approval and task.approval_state not in (
                ApprovalState.approved,
            ):
                if task.approval_state == ApprovalState.none:
                    task.status = TaskStatus.awaiting_approval
                    task.approval_state = ApprovalState.pending
                    session.add(task)
                    notify(session, "Manager",
                           f"Approval needed: '{task.title}' for {hire.name}",
                           hire.id, task.id)
                    audit(session, hire.id,
                          f"Awaiting manager approval for '{task.title}'",
                          "info", "approval_gate")
                    session.commit()
                continue

            # Only dispatch if all deps done
            deps = task.depends_on_list
            if all(d in done_keys for d in deps):
                dispatch_task(session, task, current_day, itsm_offline)

        # Refresh tasks after dispatch
        session.refresh(hire)

        # CPM
        cpm_tasks, min_slack = run_cpm_for_hire(session, hire)

        # Stall detection & self-healing
        handle_stalls(session, hire, cpm_tasks, min_slack)

        # Update readiness + status
        readiness = compute_readiness(session, hire)
        update_hire_status(session, hire, min_slack, readiness)

    session.commit()


# ---------------------------------------------------------------------------
# Create hire with plan
# ---------------------------------------------------------------------------

def create_hire_with_plan(
    session: Session,
    name: str,
    role: str,
    department: str,
    start_day: int,
    manager_id: Optional[int] = None,
) -> Hire:
    """Create a hire and generate their task plan from role template (+ optional LLM)."""
    from app.services.planner import get_plan_for_role
    from app.config import settings

    hire = Hire(name=name, role=role, department=department, start_day=start_day, manager_id=manager_id)
    session.add(hire)
    session.commit()
    session.refresh(hire)

    plan = get_plan_for_role(role, hire.id)

    for ts in plan.tasks:
        task = Task(
            hire_id=hire.id,
            key=ts.key,
            title=ts.title,
            team=ts.team,
            duration_days=ts.duration_days,
            needs_approval=ts.needs_approval,
            fallback_title=ts.fallback_title,
            fallback_days=ts.fallback_days,
        )
        task.set_depends_on(ts.depends_on)
        session.add(task)

    session.commit()
    session.refresh(hire)

    audit(session, hire.id,
          f"Hire '{name}' ({role}) created with {len(plan.tasks)} tasks planned",
          "info", "plan_generator")
    return hire
