"""
Main orchestration engine.
Dispatch tasks, detect stalls, escalate, reschedule with fallbacks.
All decisions are deterministic — LLM used only for notification messages.
"""
from typing import List, Optional, Tuple
from datetime import datetime, timedelta
import uuid
from sqlmodel import Session, select
from app.domain.models import (
    Hire, Task, TaskStatus, HireStatus, OutboxItem, AuditEvent, AppSetting,
    Notification, Ticket, SimState, ApprovalState, TaskFlag, SchedulerLease,
)
from app.services.cpm import CPMTask, compute_cpm, get_remaining_days, is_stalled
from app.services.llm import draft_escalation_message
import logging
from app.mcp_clients.tools import (
    create_ticket as mcp_create_ticket,
    set_itsm_offline,
    update_onboarding_status as mcp_update_onboarding_status,
    upsert_new_hire as mcp_upsert_new_hire,
    update_ticket_details as mcp_update_ticket_details,
    update_ticket_status as mcp_update_ticket_status,
)

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
    audit_actor = actor if actor.startswith(("agent:", "user:")) else f"agent:{actor}"
    event = AuditEvent(
        day=get_current_day(session),
        hire_id=hire_id,
        level=level,
        message=message,
        actor_agent=audit_actor,
    )
    session.add(event)


def notify(session: Session, role: str, message: str,
           hire_id: Optional[int] = None, task_id: Optional[int] = None) -> None:
    n = Notification(for_role=role, message=message, hire_id=hire_id, task_id=task_id)
    session.add(n)


# ---------------------------------------------------------------------------
# Idempotency key
# ---------------------------------------------------------------------------

def make_ikey(hire_id: int, task_key: str) -> str:
    return f"hire{hire_id}:{task_key}"


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def dispatch_task(session: Session, task: Task, current_day: int,
                  itsm_offline: bool = False, *, commit: bool = True) -> bool:
    """Create ticket for task. Returns True if dispatched, False if queued (outbox)."""
    ikey = make_ikey(task.hire_id, task.key)

    # Idempotency: never create duplicate ticket
    existing = session.exec(select(Ticket).where(Ticket.idempotency_key == ikey)).first()
    if existing:
        if task.ticket_id != existing.ticket_id:
            task.ticket_id = existing.ticket_id
            session.add(task)
            if commit:
                session.commit()
        return True

    set_itsm_offline(itsm_offline)
    result = mcp_create_ticket(
        ikey, task.title, task.team.value if hasattr(task.team, "value") else str(task.team), task.duration_days
    )
    if result.get("error") == "service_unavailable":
        # Queue in outbox (idempotent); the MCP server remains the ticket system of record.
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
            if commit:
                session.commit()
            audit(session, task.hire_id,
                  f"Task '{task.title}' queued in outbox (ITSM offline)",
                  "warning", "it_provisioner")
            if commit:
                session.commit()
        return False

    if result.get("error") or not result.get("ticket_id"):
        logger.error("ITSM create_ticket returned an invalid response: %s", result.get("error", "missing ticket id"))
        return False

    # Create a local read-model row after the MCP tool accepts the ticket.
    ticket_id = str(result["ticket_id"])
    ticket = Ticket(
        ticket_id=ticket_id,
        idempotency_key=ikey,
        title=task.title,
        team=task.team,
        estimate_days=task.duration_days,
        hire_id=task.hire_id,
        task_id=task.id,
        status=str(result.get("status", "open")),
    )
    session.add(ticket)

    task.ticket_id = ticket_id
    task.status = TaskStatus.dispatched
    task.dispatched_day = current_day
    task.last_activity_day = current_day
    session.add(task)
    if commit:
        session.commit()

    audit(session, task.hire_id,
          f"Ticket {ticket_id} created for '{task.title}' ({task.team})",
          "info", "supervisor")
    if commit:
        session.commit()
    return True


# ---------------------------------------------------------------------------
# Outbox drain
# ---------------------------------------------------------------------------

def drain_outbox(session: Session, current_day: int, *, commit: bool = True) -> None:
    """Drain queued outbox items — idempotent, no duplicate tickets."""
    # Callers drain only after observing recovery. The monitor sets the outage
    # flag before this method, and invokes it only when the service is online.
    set_itsm_offline(False)
    items = session.exec(select(OutboxItem)).all()
    for item in items:
        # Double-check idempotency
        existing = session.exec(
            select(Ticket).where(Ticket.idempotency_key == item.idempotency_key)
        ).first()
        if existing:
            session.delete(item)
            continue

        result = mcp_create_ticket(item.idempotency_key, item.title, item.team, item.estimate_days)
        if result.get("error") == "service_unavailable" or not result.get("ticket_id"):
            item.retry_count += 1
            session.add(item)
            continue
        ticket_id = str(result["ticket_id"])
        ticket = Ticket(
            ticket_id=ticket_id,
            idempotency_key=item.idempotency_key,
            title=item.title,
            team=item.team,
            estimate_days=item.estimate_days,
            hire_id=item.hire_id,
            task_id=item.task_id,
            status=str(result.get("status", "open")),
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
    if commit:
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
    # The enclosing monitor cycle commits all state and audit changes together.

    min_slack = min(ct.slack for ct in computed)
    return computed, min_slack


# ---------------------------------------------------------------------------
# Stall detection & self-healing
# ---------------------------------------------------------------------------

def handle_stalls(
    session: Session, hire: Hire,
    cpm_tasks: List[CPMTask], min_slack: float,
    stall_after_days: int = 2, near_critical_margin: int = 1,
) -> None:
    """Detect stalled tasks on critical/near-critical path; escalate + reschedule."""
    current_day = get_current_day(session)
    db_tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    task_map = {t.key: t for t in db_tasks}
    cpm_map = {ct.key: ct for ct in cpm_tasks}

    for key, task in task_map.items():
        if not is_stalled(task, current_day, stall_after_days):
            continue
        ct = cpm_map.get(key)
        if ct is None:
            continue

        # Only act on critical or near-critical tasks (avoid alert fatigue)
        if ct.slack > min_slack + near_critical_margin:
            if task.flag == TaskFlag.none:
                task.flag = TaskFlag.watch
                session.add(task)
            continue

        # Escalate
        if task.flag not in (TaskFlag.escalated, TaskFlag.rescheduled):
            task.flag = TaskFlag.escalated
            session.add(task)
            msg = draft_escalation_message(hire.name, task.title, ct.slack)
            audit(session, hire.id, msg, "critical", "progress_monitor")
            notify(session, "Manager", msg, hire.id, task.id)
            notify(session, "IT",
                   f"Action needed: '{task.title}' for {hire.name} is stalled.",
                   hire.id, task.id)

        # Reschedule with fallback if available
        if task.fallback_title and task.flag != TaskFlag.rescheduled:
            old_title = task.title
            fallback_title = task.fallback_title
            fallback_days = task.fallback_days or 1
            if task.ticket_id:
                result = mcp_update_ticket_details(task.ticket_id, fallback_title, fallback_days)
                if result.get("error"):
                    logger.warning("Fallback update for ticket %s deferred: %s", task.ticket_id, result.get("error"))
                    continue
                reopened = mcp_update_ticket_status(task.ticket_id, "open")
                if reopened.get("error"):
                    logger.warning("Fallback reopen for ticket %s deferred: %s", task.ticket_id, reopened.get("error"))
                    continue
                ticket = session.exec(select(Ticket).where(Ticket.ticket_id == task.ticket_id)).first()
                if ticket:
                    ticket.title = fallback_title
                    ticket.estimate_days = fallback_days
                    ticket.status = "open"
                    ticket.updated_at = datetime.utcnow()
                    session.add(ticket)
            else:
                queued = session.exec(select(OutboxItem).where(OutboxItem.task_id == task.id)).first()
                if queued:
                    queued.title = fallback_title
                    queued.estimate_days = fallback_days
                    session.add(queued)
            task.flag = TaskFlag.rescheduled
            task.title = fallback_title
            task.duration_days = fallback_days
            task.fallback_title = None
            task.fallback_days = None
            task.last_activity_day = current_day
            session.add(task)
            audit(session, hire.id,
                  f"RESCHEDULED: '{old_title}' → fallback '{task.title}' ({task.duration_days}d)",
                  "warning", "progress_monitor")
    # The enclosing monitor cycle commits reschedule and notification records together.


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
        if hire.ready_at is None:
            hire.ready_at = datetime.utcnow()
    elif min_slack < 0:
        hire.status = HireStatus.at_risk
    else:
        hire.status = HireStatus.on_track

    hire.projected_day = (
        hire.start_day + max(0, int(-min_slack)) if min_slack < 0 else hire.start_day
    )
    session.add(hire)
    # The enclosing monitor cycle commits the hire read-model and audit together.
    mcp_update_onboarding_status(hire.id, str(hire.status), hire.readiness)


# ---------------------------------------------------------------------------
# Monitor tick (the main scheduled loop)
# ---------------------------------------------------------------------------

def _monitor_tick_body(session: Session) -> None:
    """
    Main monitor loop:
    1. Drain outbox if ITSM online
    2. For each hire: dispatch unblocked tasks, run CPM, detect stalls, update status
    """
    sim_state = get_or_create_sim_state(session)
    current_day = sim_state.current_day
    itsm_offline = sim_state.itsm_offline
    saved_settings = {row.key: row.value for row in session.exec(select(AppSetting)).all()}
    stall_after_days = int(saved_settings.get("stall_after_days", "2"))
    near_critical_margin = int(saved_settings.get("near_critical_margin", "1"))
    auto_worker_enabled = saved_settings.get("auto_worker_enabled", "false").lower() == "true"
    set_itsm_offline(itsm_offline)

    if not itsm_offline:
        drain_outbox(session, current_day, commit=False)

    if auto_worker_enabled and not itsm_offline:
        for ticket in session.exec(select(Ticket).where(Ticket.status.in_(["open", "in_progress"]))).all():
            task = session.get(Task, ticket.task_id) if ticket.task_id else None
            if task is None or task.dispatched_day is None or current_day - task.dispatched_day < ticket.estimate_days:
                continue
            result = mcp_update_ticket_status(ticket.ticket_id, "done")
            if result.get("error"):
                continue
            ticket.status = "done"
            ticket.updated_at = datetime.utcnow()
            task.status = TaskStatus.done
            task.last_activity_day = current_day
            session.add(ticket)
            session.add(task)
            audit(session, ticket.hire_id or 0, f"Demo auto-worker completed '{ticket.title}'", "info", "demo_auto_worker")

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
                    task.approval_requested_at = task.approval_requested_at or datetime.utcnow()
                    session.add(task)
                    notify(session, "Manager",
                           f"Approval needed: '{task.title}' for {hire.name}",
                           hire.id, task.id)
                    audit(session, hire.id,
                          f"Awaiting manager approval for '{task.title}'",
                          "info", "approval_gate")
                continue

            # Only dispatch if all deps done
            deps = task.depends_on_list
            if all(d in done_keys for d in deps):
                dispatch_task(session, task, current_day, itsm_offline, commit=False)

        # Refresh tasks after dispatch
        session.refresh(hire)

        # CPM
        cpm_tasks, min_slack = run_cpm_for_hire(session, hire)

        # Stall detection & self-healing
        handle_stalls(session, hire, cpm_tasks, min_slack, stall_after_days, near_critical_margin)

        # Update readiness + status
        readiness = compute_readiness(session, hire)
        update_hire_status(session, hire, min_slack, readiness)

    session.commit()


def _acquire_monitor_lease(session: Session, owner_id: str, lease_seconds: int = 60) -> bool:
    now = datetime.utcnow()
    lease = session.get(SchedulerLease, 1)
    if lease is None:
        lease = SchedulerLease(id=1, owner_id="", lease_until=datetime(1970, 1, 1))
        session.add(lease)
        session.commit()
        session.refresh(lease)
    if lease.lease_until > now and lease.owner_id != owner_id:
        return False
    lease.owner_id = owner_id
    lease.lease_until = now + timedelta(seconds=lease_seconds)
    lease.updated_at = now
    session.add(lease)
    session.commit()
    return True


def _release_monitor_lease(session: Session, owner_id: str) -> None:
    lease = session.get(SchedulerLease, 1)
    if lease is not None and lease.owner_id == owner_id:
        now = datetime.utcnow()
        lease.owner_id = ""
        lease.lease_until = now
        lease.updated_at = now
        session.add(lease)
        session.commit()


def monitor_tick(session: Session) -> bool:
    """Run one monitor cycle under a durable DB lease; safe to retry after restart."""
    # Ensure the simulation row exists before lease acquisition starts the cycle.
    get_or_create_sim_state(session)
    owner_id = str(uuid.uuid4())
    if not _acquire_monitor_lease(session, owner_id):
        logger.info("Monitor tick skipped; another worker owns the lease")
        return False
    try:
        _monitor_tick_body(session)
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        _release_monitor_lease(session, owner_id)


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
    import json
    from app.services.planner import PlanSpec, try_llm_plan
    from app.config import settings
    from app.domain.models import OnboardingTemplate

    hire = Hire(name=name, role=role, department=department, start_day=start_day, manager_id=manager_id)
    session.add(hire)
    session.commit()
    session.refresh(hire)

    mcp_upsert_new_hire(hire.id, hire.name, hire.role, hire.department, hire.start_day)

    saved_template = session.exec(
        select(OnboardingTemplate).where(OnboardingTemplate.role_key == role, OnboardingTemplate.active.is_(True))
        .order_by(OnboardingTemplate.version.desc())
    ).first()
    if saved_template:
        plan = PlanSpec.model_validate({"tasks": json.loads(saved_template.tasks_json)})
    else:
        plan = try_llm_plan(role, hire.id, settings.GEMINI_API_KEY)

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
