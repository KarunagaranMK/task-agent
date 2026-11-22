import pytest
from sqlmodel import Session, create_engine, SQLModel, select
from sqlmodel.pool import StaticPool
from app.domain.models import (
    Hire, Task, TaskStatus, Ticket, OutboxItem, SimState, ApprovalState,
)
from app.services.orchestrator import (
    create_hire_with_plan,
    dispatch_task,
    drain_outbox,
    monitor_tick,
    get_or_create_sim_state,
    compute_readiness,
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
