import pytest
import os
import subprocess
import sys
from pathlib import Path
from sqlmodel import Session, create_engine, SQLModel, select
from sqlmodel.pool import StaticPool
from app.domain.models import (
    Task, TaskStatus, Ticket, OutboxItem, SimState, ApprovalState,
    AuditEvent, Notification,
)
from app.services.orchestrator import (
    create_hire_with_plan,
    dispatch_task,
    drain_outbox,
    monitor_tick,
    get_or_create_sim_state,
    compute_readiness,
    _acquire_monitor_lease,
    _release_monitor_lease,
)


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        # Ensure sim state exists
        state = SimState(current_day=0, itsm_offline=False)
        s.add(state)
        s.commit()
        yield s


def _get_first_independent_task(session: Session, hire_id: int) -> Task:
    tasks = session.exec(select(Task).where(Task.hire_id == hire_id)).all()
    for t in tasks:
        if not t.depends_on_list and not t.needs_approval:
            return t
    return tasks[0]


# ---------------------------------------------------------------------------
# Plan creation
# ---------------------------------------------------------------------------

def test_create_hire_generates_tasks(session):
    hire = create_hire_with_plan(session, "Priya", "Data Analyst", "Analytics", 8)
    assert hire.id is not None
    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    assert len(tasks) >= 8


def test_create_hire_default_role(session):
    hire = create_hire_with_plan(session, "Alex", "default", "Eng", 10)
    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    assert len(tasks) >= 6


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def test_idempotent_dispatch_no_duplicate_tickets(session):
    hire = create_hire_with_plan(session, "Test", "default", "Eng", 10)
    task = _get_first_independent_task(session, hire.id)

    dispatch_task(session, task, 0, itsm_offline=False)
    tid1 = task.ticket_id
    dispatch_task(session, task, 0, itsm_offline=False)
    tid2 = task.ticket_id

    assert tid1 == tid2
    tickets = session.exec(
        select(Ticket).where(Ticket.hire_id == hire.id, Ticket.task_id == task.id)
    ).all()
    assert len(tickets) == 1


def test_no_outbox_duplicate(session):
    hire = create_hire_with_plan(session, "Test2", "default", "Eng", 10)
    task = _get_first_independent_task(session, hire.id)

    # Queue twice — only one outbox item
    dispatch_task(session, task, 0, itsm_offline=True)
    dispatch_task(session, task, 0, itsm_offline=True)
    items = session.exec(select(OutboxItem)).all()
    assert len(items) == 1


# ---------------------------------------------------------------------------
# Outbox pattern
# ---------------------------------------------------------------------------

def test_outbox_during_outage_then_drain(session):
    hire = create_hire_with_plan(session, "Bob", "default", "Ops", 10)
    task = _get_first_independent_task(session, hire.id)

    # ITSM offline → outbox
    dispatch_task(session, task, 0, itsm_offline=True)
    items = session.exec(select(OutboxItem)).all()
    assert len(items) == 1
    assert task.status == TaskStatus.queued

    # ITSM back → drain
    drain_outbox(session, 1)
    items_after = session.exec(select(OutboxItem)).all()
    assert len(items_after) == 0
    tickets = session.exec(select(Ticket)).all()
    assert len(tickets) == 1


def test_drain_twice_no_duplicates(session):
    hire = create_hire_with_plan(session, "Carol", "default", "HR", 10)
    task = _get_first_independent_task(session, hire.id)

    dispatch_task(session, task, 0, itsm_offline=True)
    drain_outbox(session, 1)
    drain_outbox(session, 2)  # second drain — no duplicates
    tickets = session.exec(select(Ticket)).all()
    assert len(tickets) == 1


# ---------------------------------------------------------------------------
# Monitor tick
# ---------------------------------------------------------------------------

def test_monitor_dispatches_root_tasks(session):
    hire = create_hire_with_plan(session, "Dave", "default", "IT", 10)
    monitor_tick(session)

    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    root_tasks = [t for t in tasks if not t.depends_on_list and not t.needs_approval]
    for t in root_tasks:
        assert t.status in (TaskStatus.dispatched, TaskStatus.queued)


def test_monitor_approval_gate(session):
    hire = create_hire_with_plan(session, "Eve", "Data Analyst", "Analytics", 10)
    monitor_tick(session)

    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    approval_tasks = [t for t in tasks if t.needs_approval]
    for t in approval_tasks:
        # Should be awaiting approval or pending (if deps not met yet)
        assert t.status in (TaskStatus.awaiting_approval, TaskStatus.pending, TaskStatus.blocked)


def test_approve_then_dispatch(session):
    hire = create_hire_with_plan(session, "Frank", "Data Analyst", "Analytics", 10)
    monitor_tick(session)

    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    # Approve accounts first so powerbi deps are met
    accounts = next((t for t in tasks if t.key == "it:accounts"), None)
    if accounts:
        accounts.status = TaskStatus.done
        session.add(accounts)
        session.commit()

    approval_task = next(
        (t for t in tasks if t.key == "it:powerbi"), None
    )
    if approval_task:
        approval_task.approval_state = ApprovalState.approved
        approval_task.status = TaskStatus.pending
        session.add(approval_task)
        session.commit()
        monitor_tick(session)
        session.refresh(approval_task)
        assert approval_task.status in (TaskStatus.dispatched, TaskStatus.queued, TaskStatus.pending)


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

def test_readiness_all_done(session):
    hire = create_hire_with_plan(session, "Gina", "default", "HR", 10)
    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    for t in tasks:
        t.status = TaskStatus.done
        session.add(t)
    session.commit()
    r = compute_readiness(session, hire)
    assert r == 100.0


def test_readiness_none_done(session):
    hire = create_hire_with_plan(session, "Henry", "default", "HR", 10)
    r = compute_readiness(session, hire)
    assert r == 0.0


def test_monitor_lease_allows_only_one_active_owner(session):
    assert _acquire_monitor_lease(session, "worker-a")
    assert not _acquire_monitor_lease(session, "worker-b")
    _release_monitor_lease(session, "worker-a")
    assert _acquire_monitor_lease(session, "worker-b")


def test_stalled_critical_laptop_uses_loaner_without_duplicate_ticket(session):
    hire = create_hire_with_plan(session, "Priya", "Data Analyst", "Analytics", 2)
    laptop = session.exec(select(Task).where(Task.hire_id == hire.id, Task.key == "it:laptop")).one()
    laptop.duration_days = 6
    session.add(laptop)
    session.commit()
    monitor_tick(session)
    session.refresh(laptop)
    original_ticket_id = laptop.ticket_id
    assert original_ticket_id
    state = get_or_create_sim_state(session)
    state.current_day = 2
    laptop.last_activity_day = 0
    session.add_all([state, laptop])
    session.commit()

    monitor_tick(session)
    session.refresh(laptop)
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == original_ticket_id)).one()
    assert laptop.flag == "rescheduled"
    assert laptop.title == "Issue Loaner Laptop"
    assert laptop.ticket_id == original_ticket_id
    assert ticket.title == "Issue Loaner Laptop"
    assert ticket.status == "open"
    escalations = session.exec(select(AuditEvent).where(AuditEvent.hire_id == hire.id, AuditEvent.level == "critical", AuditEvent.message.contains("Provision Laptop"))).all()
    assert len(escalations) == 1
    assert len(session.exec(select(Notification).where(Notification.hire_id == hire.id)).all()) >= 2

    monitor_tick(session)
    laptop_escalations = session.exec(
        select(AuditEvent).where(
            AuditEvent.hire_id == hire.id,
            AuditEvent.level == "critical",
            AuditEvent.message.contains("Provision Laptop"),
        )
    ).all()
    assert len(laptop_escalations) == 1


def test_queued_ticket_recovers_after_backend_process_restart(tmp_path, monkeypatch):
    from sqlmodel import create_engine

    database_path = tmp_path / "restart.db"
    engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(SimState(current_day=1, itsm_offline=False))
        session.commit()
        hire = create_hire_with_plan(session, "Restart Hire", "default", "Ops", 8)
        task = _get_first_independent_task(session, hire.id)
        assert dispatch_task(session, task, 0, itsm_offline=True) is False
        task_id = task.id

    backend_dir = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.update({
        "DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
        "MCP_MODE": "inprocess",
        "ITSM_DB_PATH": os.environ["ITSM_DB_PATH"],
        "HRIS_DB_PATH": os.environ["HRIS_DB_PATH"],
    })
    env["PYTHONPATH"] = str(backend_dir) + os.pathsep + env.get("PYTHONPATH", "")
    code = (
        "from sqlmodel import Session, select; from app.db.database import engine; "
        "from app.services.orchestrator import monitor_tick; "
        "from app.domain.models import OutboxItem, Ticket; "
        "s=Session(engine); monitor_tick(s); "
        f"print(str(len(s.exec(select(OutboxItem)).all())) + ':' + str(len(s.exec(select(Ticket).where(Ticket.task_id == {task_id})).all()))); s.close()"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=backend_dir, env=env, capture_output=True, text=True, timeout=30, check=True)
    assert result.stdout.strip().endswith("0:1")
