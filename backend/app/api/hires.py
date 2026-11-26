from datetime import date, datetime
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlmodel import Session, func, select

from app.auth import require_roles
from app.db.database import commit_now, get_session
from app.domain.models import (
    ApprovalState,
    AuditEvent,
    Hire,
    HireStatus,
    MailOutbox,
    OutboxItem,
    Task,
    TaskStatus,
    Ticket,
)
from app.mcp_clients.tools import cancel_ticket as mcp_cancel_ticket
from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status
from app.services.clock import load_clock
from app.services.cpm import CPMTask, compute_cpm, compute_what_if, get_remaining_days
from app.services.orchestrator import (
    audit,
    compute_readiness,
    create_hire_with_plan,
    dispatch_task,
    get_current_day,
    notify,
    replace_hire_plan_before_work_starts,
    run_cpm_for_hire,
    update_hire_status,
)
from app.services.email_delivery import deliver_outbox_message

router = APIRouter(prefix="/hires", tags=["hires"])


class HireCreate(BaseModel):
    name: str
    role: str
    department: str
    work_email: Optional[str] = Field(default=None, max_length=254)
    work_location: Optional[str] = Field(default=None, max_length=120)
    employment_type: Optional[str] = Field(default=None, max_length=80)
    required_equipment: Optional[str] = Field(default=None, max_length=1000)
    required_software: Optional[str] = Field(default=None, max_length=1000)
    additional_notes: Optional[str] = Field(default=None, max_length=2000)
    start_day: Optional[int] = Field(default=None, ge=1, le=365)
    start_date: Optional[date] = None

    @field_validator("work_email")
    @classmethod
    def validate_work_email(cls, value: Optional[str]):
        import re
        if value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid work email address")
        return value

    @model_validator(mode="after")
    def require_start_target(self):
        if (self.start_day is None) == (self.start_date is None):
            raise ValueError("Provide exactly one of start_day or start_date")
        return self


class HireUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[str] = Field(default=None, min_length=1, max_length=120)
    department: Optional[str] = Field(default=None, min_length=1, max_length=120)
    work_email: Optional[str] = Field(default=None, max_length=254)
    work_location: Optional[str] = Field(default=None, max_length=120)
    employment_type: Optional[str] = Field(default=None, max_length=80)
    required_equipment: Optional[str] = Field(default=None, max_length=1000)
    required_software: Optional[str] = Field(default=None, max_length=1000)
    additional_notes: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None

    @field_validator("work_email")
    @classmethod
    def validate_work_email(cls, value: Optional[str]):
        import re
        if value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid work email address")
        return value

    @model_validator(mode="after")
    def require_editable_field(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one hire detail to update")
        return self


class PlanPreviewRequest(BaseModel):
    role: str = Field(min_length=1, max_length=120)


class WhatIfRequest(BaseModel):
    task_key: str
    delay_days: int = Field(ge=0, le=10)


class DelayNoticeRequest(BaseModel):
    revised_joining_date: date
    reason: str = Field(min_length=8, max_length=600)


class RiskExplanation(BaseModel):
    explanation: str = Field(min_length=8, max_length=700)


class TaskOut(BaseModel):
    id: UUID
    key: str
    title: str
    team: str
    duration_days: int
    depends_on: List[str]
    status: str
    ticket_id: Optional[str]
    slack: Optional[float]
    critical: bool
    flag: str
    dispatched_day: Optional[int] = None
    remaining_days: float
    schedule_start_day: Optional[float] = None
    schedule_finish_day: Optional[float] = None
    current_day: int


class HireOut(BaseModel):
    id: UUID
    name: str
    role: str
    department: str
    work_email: Optional[str] = None
    work_location: Optional[str] = None
    employment_type: Optional[str] = None
    required_equipment: Optional[str] = None
    required_software: Optional[str] = None
    additional_notes: Optional[str] = None
    start_day: int
    start_date: Optional[date]
    status: str
    readiness: float
    projected_day: Optional[int]
    projected_ready_date: Optional[date]


@router.post("/plan-preview")
def plan_preview(data: PlanPreviewRequest, session: Session = Depends(get_session), _user=Depends(require_roles("HR"))):
    from app.services.orchestrator import plan_spec_for_role
    plan = plan_spec_for_role(session, data.role, hire_id=None)
    return {"role": data.role, "tasks": [task.model_dump() for task in plan.tasks]}


def _hire_out(h: Hire, session: Session) -> HireOut:
    clock = load_clock(session)
    projected_ready_date = None
    if h.start_date and h.projected_day is not None:
        projected_ready_date = clock.calendar.add_business_days(h.start_date, h.projected_day - h.start_day)
    return HireOut(
        id=UUID(h.public_id),
        name=h.name,
        role=h.role,
        department=h.department,
        work_email=h.work_email,
        work_location=h.work_location,
        employment_type=h.employment_type,
        required_equipment=h.required_equipment,
        required_software=h.required_software,
        additional_notes=h.additional_notes,
        start_day=h.start_day,
        start_date=h.start_date,
        status=h.status,
        readiness=h.readiness,
        projected_day=h.projected_day,
        projected_ready_date=projected_ready_date,
    )


def _hire_by_public_id(public_id: UUID, session: Session) -> Hire | None:
    return session.exec(select(Hire).where(Hire.public_id == str(public_id))).first()


@router.post("", response_model=HireOut)
def create_hire(data: HireCreate, session: Session = Depends(get_session), _user=Depends(require_roles("HR"))):
    if data.start_date is not None:
        current_day = get_current_day(session)
        clock = load_clock(session, current_day)
        if not clock.calendar.is_business_day(data.start_date):
            raise HTTPException(422, "Joining date must be a business day in the organization calendar")
        days_until_start = clock.calendar.business_days_between(clock.today(), data.start_date)
        if days_until_start < 1:
            raise HTTPException(422, "Joining date must be after the current organization date")
        start_day = current_day + days_until_start
        start_date = data.start_date
    else:
        start_day = data.start_day
        clock = load_clock(session)
        start_date = clock.calendar.add_business_days(clock.local_today(), start_day)
    hire = create_hire_with_plan(session, data.name, data.role, data.department, start_day, None, start_date)
    for field in ("work_email", "work_location", "employment_type", "required_equipment", "required_software", "additional_notes"):
        value = getattr(data, field)
        setattr(hire, field, value.strip() if isinstance(value, str) and value.strip() else None)
    session.add(hire)
    # Persist the hire and its plan, then immediately dispatch tasks with no
    # dependencies so IT and Facilities can see the new employee right away.
    # The full monitor runs on a configured interval (15 minutes by default).
    session.commit()
    current_day = get_current_day(session)
    ready_tasks = session.exec(
        select(Task).where(Task.hire_id == hire.id, Task.status == TaskStatus.pending)
    ).all()
    for task in ready_tasks:
        if not task.depends_on_list:
            dispatch_task(session, task, current_day, commit=False)
    session.commit()
    return _hire_out(hire, session)


@router.get("", response_model=List[HireOut])
def list_hires(
    response: Response,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    limit: Optional[int] = Query(default=None, ge=1, le=100),
    offset: Optional[int] = Query(default=None, ge=0),
    search: str = Query(default="", max_length=120),
    include_archived: bool = False,
    status: Optional[Literal["on_track", "at_risk", "ready", "started", "paused", "cancelled"]] = None,
    sort_by: Literal["created_at", "name", "start_date", "readiness", "status"] = "created_at",
    sort_order: Literal["asc", "desc"] = "desc",
    session: Session = Depends(get_session),
    user=Depends(require_roles("ADMIN", "HR")),
):
    filters = []
    if not include_archived:
        filters.append(Hire.archived.is_(False))
    if status:
        filters.append(Hire.status == status)
    if search.strip():
        term = f"%{search.strip()}%"
        filters.append((Hire.name.ilike(term)) | (Hire.role.ilike(term)) | (Hire.department.ilike(term)))
    count_query = select(func.count()).select_from(Hire).where(*filters)
    total = session.exec(count_query).one()
    sort_column = {
        "created_at": Hire.created_at,
        "name": Hire.name,
        "start_date": Hire.start_date,
        "readiness": Hire.readiness,
        "status": Hire.status,
    }[sort_by]
    ordering = sort_column.asc() if sort_order == "asc" else sort_column.desc()
    effective_limit = limit if limit is not None else page_size
    effective_offset = offset if offset is not None else (0 if limit is not None else (page - 1) * page_size)
    effective_page = effective_offset // effective_limit + 1
    query = select(Hire).where(*filters).order_by(ordering, Hire.id.asc()).offset(effective_offset).limit(effective_limit)
    hires = session.exec(query).all()
    total_pages = (total + effective_limit - 1) // effective_limit
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(total_pages)
    response.headers["X-Page"] = str(effective_page)
    response.headers["X-Page-Size"] = str(effective_limit)
    response.headers["X-Limit"] = str(effective_limit)
    response.headers["X-Offset"] = str(effective_offset)
    return [_hire_out(h, session) for h in hires]


@router.post("/{hire_id}/archive")
def archive_hire(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if not hire:
        raise HTTPException(404, "Hire not found")
    if not hire.archived:
        hire.archived = True
        session.add(hire)
        audit(session, hire.id, f"Archived employee record for {hire.name}", "info", f"user:{user.id}")
    return {"status": "archived", "hire_id": hire.public_id}


@router.get("/employee-communications")
def list_employee_communications(
    session: Session = Depends(get_session), _user=Depends(require_roles("HR"))
):
    current_day = get_current_day(session)
    today = load_clock(session, current_day).today()
    hires = session.exec(select(Hire).where(Hire.archived.is_(False)).order_by(Hire.start_date, Hire.name)).all()
    messages = session.exec(
        select(MailOutbox)
        .where(MailOutbox.kind.in_(["joining_confirmation", "joining_delay"]))
        .order_by(MailOutbox.created_at.desc())
    ).all()
    messages_by_hire: dict[int, list[MailOutbox]] = {}
    for message in messages:
        if message.hire_id is not None:
            messages_by_hire.setdefault(message.hire_id, []).append(message)

    result = []
    for hire in hires:
        readiness = compute_readiness(session, hire)
        hire_messages = messages_by_hire.get(hire.id, [])
        confirmation_key = f"hire:{hire.public_id}:confirmation:{hire.start_date}"
        confirmation = next((item for item in hire_messages if item.dedupe_key == confirmation_key), None)
        delay_due = bool(
            hire.start_date
            and hire.start_date <= today
            and readiness < 100
            and hire.status not in (HireStatus.paused, HireStatus.cancelled)
        )
        result.append({
            "hire_id": hire.public_id,
            "name": hire.name,
            "role": hire.role,
            "department": hire.department,
            "work_email": hire.work_email,
            "joining_date": hire.start_date.isoformat() if hire.start_date else None,
            "readiness": readiness,
            "confirmation_available": readiness >= 100 and confirmation is None and bool(hire.work_email),
            "confirmation_status": "sent" if confirmation and confirmation.sent_at else "queued" if confirmation else None,
            "delay_required": delay_due,
            "messages": [{
                "id": item.public_id,
                "kind": item.kind,
                "recipient": item.recipient,
                "subject": item.subject,
                "body": item.body,
                "status": "sent" if item.sent_at else "queued",
                "created_at": item.created_at.isoformat(),
            } for item in hire_messages],
        })
    return result


@router.post("/{hire_id}/employee-communications/confirmation")
def queue_joining_confirmation(
    hire_id: UUID,
    session: Session = Depends(get_session),
    user=Depends(require_roles("HR")),
):
    hire = _hire_by_public_id(hire_id, session)
    if hire is None or hire.archived:
        raise HTTPException(404, "Active employee onboarding record not found")
    if not hire.work_email:
        raise HTTPException(422, "Add the employee's work email before sending a confirmation")
    if compute_readiness(session, hire) < 100:
        raise HTTPException(409, "Joining confirmation is available after all onboarding tasks are accepted")

    joining_date = hire.start_date
    if joining_date is None:
        raise HTTPException(409, "Set a joining date before sending a confirmation")
    dedupe_key = f"hire:{hire.public_id}:confirmation:{joining_date}"
    if session.exec(select(MailOutbox).where(MailOutbox.dedupe_key == dedupe_key)).first():
        raise HTTPException(409, "A joining confirmation is already in the mail outbox for this date")
    body = (
        f"Hello {hire.name},\n\n"
        f"Your onboarding is complete and your joining date is confirmed for {joining_date:%d %B %Y}. "
        "We look forward to welcoming you.\n\nRegards,\nHuman Resources"
    )
    message = MailOutbox(
        recipient=hire.work_email,
        subject=f"Joining date confirmed · {joining_date:%d %B %Y}",
        body=body,
        hire_id=hire.id,
        kind="joining_confirmation",
        dedupe_key=dedupe_key,
        created_by_id=user.id,
    )
    session.add(message)
    audit(session, hire.id, f"HR queued a joining confirmation for {hire.name} ({joining_date})", "info", f"user:{user.id}")
    commit_now(session)
    delivered = deliver_outbox_message(session, message)
    return {"status": "sent" if delivered else "queued", "message_id": message.public_id, "recipient": message.recipient}


@router.post("/{hire_id}/employee-communications/delay")
def queue_joining_delay_notice(
    hire_id: UUID,
    data: DelayNoticeRequest,
    session: Session = Depends(get_session),
    user=Depends(require_roles("HR")),
):
    hire = _hire_by_public_id(hire_id, session)
    if hire is None or hire.archived:
        raise HTTPException(404, "Active employee onboarding record not found")
    if not hire.work_email:
        raise HTTPException(422, "Add the employee's work email before sending a delay notice")
    readiness = compute_readiness(session, hire)
    current_day = get_current_day(session)
    clock = load_clock(session, current_day)
    today = clock.today()
    if readiness >= 100:
        raise HTTPException(409, "This employee is ready; send a joining confirmation instead")
    if hire.start_date is None or hire.start_date > today:
        raise HTTPException(409, "A delay notice is available after the planned joining date is reached")
    if not clock.calendar.is_business_day(data.revised_joining_date):
        raise HTTPException(422, "The revised joining date must be a business day")
    days_until_start = clock.calendar.business_days_between(today, data.revised_joining_date)
    if days_until_start < 1:
        raise HTTPException(422, "Choose a revised joining date after today")

    prior_date = hire.start_date
    dedupe_key = f"hire:{hire.public_id}:delay:{prior_date}:{data.revised_joining_date}"
    if session.exec(select(MailOutbox).where(MailOutbox.dedupe_key == dedupe_key)).first():
        raise HTTPException(409, "A delay notice for this revised date is already in the mail outbox")

    hire.start_date = data.revised_joining_date
    hire.start_day = current_day + days_until_start
    _tasks, min_slack = run_cpm_for_hire(session, hire)
    update_hire_status(session, hire, min_slack, readiness)
    body = (
        f"Hello {hire.name},\n\n"
        f"Your onboarding is still in progress, so HR has revised your joining date from "
        f"{prior_date:%d %B %Y} to {data.revised_joining_date:%d %B %Y}. "
        f"Reason: {data.reason.strip()}\n\n"
        "Please wait for a further confirmation from HR before making joining arrangements.\n\n"
        "Regards,\nHuman Resources"
    )
    message = MailOutbox(
        recipient=hire.work_email,
        subject=f"Update to your joining date · {data.revised_joining_date:%d %B %Y}",
        body=body,
        hire_id=hire.id,
        kind="joining_delay",
        dedupe_key=dedupe_key,
        created_by_id=user.id,
    )
    session.add(hire)
    session.add(message)
    audit(
        session,
        hire.id,
        f"HR revised {hire.name}'s joining date from {prior_date} to {data.revised_joining_date} and queued a delay notice",
        "warning",
        f"user:{user.id}",
    )
    commit_now(session)
    delivered = deliver_outbox_message(session, message)
    return {"status": "sent" if delivered else "queued", "message_id": message.public_id, "recipient": message.recipient}


@router.post("/employee-communications/{message_id}/retry")
def retry_employee_email(
    message_id: UUID,
    session: Session = Depends(get_session),
    _user=Depends(require_roles("HR")),
):
    message = session.exec(
        select(MailOutbox).where(
            MailOutbox.public_id == str(message_id),
            MailOutbox.kind.in_(["joining_confirmation", "joining_delay"]),
        )
    ).first()
    if message is None:
        raise HTTPException(404, "Employee email not found")
    if message.sent_at is not None:
        raise HTTPException(409, "This employee email has already been sent")
    delivered = deliver_outbox_message(session, message)
    return {"status": "sent" if delivered else "queued", "message_id": message.public_id}


@router.get("/{hire_id}", response_model=HireOut)
def get_hire(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if not hire:
        raise HTTPException(404, "Hire not found")
    return _hire_out(hire, session)


@router.patch("/{hire_id}", response_model=HireOut)
def update_hire_details(
    hire_id: UUID,
    data: HireUpdate,
    session: Session = Depends(get_session),
    user=Depends(require_roles("ADMIN", "HR")),
):
    hire = _get_editable_hire(hire_id, session)
    changes = data.model_dump(exclude_unset=True)
    if any(
        field in changes and (not isinstance(changes[field], str) or not changes[field].strip())
        for field in ("name", "department")
    ):
        raise HTTPException(422, "Name and department cannot be empty")
    role_changed = "role" in changes and changes["role"] != hire.role
    if "role" in changes:
        if not isinstance(changes["role"], str) or not changes["role"].strip():
            raise HTTPException(422, "Role cannot be empty")
        changes["role"] = changes["role"].strip()
        role_changed = changes["role"] != hire.role

    date_changed = "start_date" in changes
    if date_changed:
        if changes["start_date"] is None:
            raise HTTPException(422, "Joining date cannot be empty")
        if hire.status in (HireStatus.ready, HireStatus.cancelled, HireStatus.paused):
            raise HTTPException(409, "Resume the plan before changing its joining date")
        current_day = get_current_day(session)
        clock = load_clock(session, current_day)
        joining_date = changes["start_date"]
        if not clock.calendar.is_business_day(joining_date):
            raise HTTPException(422, "Joining date must be a business day in the organization calendar")
        days_until_start = clock.calendar.business_days_between(clock.today(), joining_date)
        if days_until_start < 1:
            raise HTTPException(422, "Joining date must be after the current organization date")
        hire.start_date = joining_date
        hire.start_day = current_day + days_until_start

    if role_changed:
        try:
            replace_hire_plan_before_work_starts(session, hire, changes["role"], f"user:{user.id}")
        except ValueError as exc:
            session.rollback()
            raise HTTPException(409, str(exc)) from exc

    for field in ("name", "department", "work_email", "work_location", "employment_type", "required_equipment", "required_software", "additional_notes"):
        if field in changes:
            value = changes[field]
            normalized = value.strip() if isinstance(value, str) else value
            if field.startswith("work_") or field in {"employment_type", "required_equipment", "required_software", "additional_notes"}:
                normalized = normalized or None
            setattr(hire, field, normalized)

    if date_changed:
        _tasks, min_slack = run_cpm_for_hire(session, hire)
        update_hire_status(session, hire, min_slack, compute_readiness(session, hire))
    changed = ", ".join(sorted(changes))
    audit(session, hire.id, f"Hire details updated by {user.name}: {changed}", "info", f"user:{user.id}")
    session.add(hire)
    session.commit()
    return _hire_out(hire, session)


@router.get("/{hire_id}/tasks", response_model=List[TaskOut])
def get_hire_tasks(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if hire is None:
        raise HTTPException(404, "Hire not found")
    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    released = False
    for task in tasks:
        if task.status == TaskStatus.awaiting_approval or task.needs_approval:
            if task.status == TaskStatus.awaiting_approval:
                task.status = TaskStatus.dispatched if task.ticket_id else TaskStatus.pending
            task.needs_approval = False
            task.approval_state = ApprovalState.none
            task.approval_requested_at = None
            task.approval_decided_at = None
            session.add(task)
            released = True
    if released:
        audit(session, hire.id, "Released legacy manager-held tasks into the department workflow", "info", "system:workflow_update")
        session.commit()
    current_day = get_current_day(session)
    open_statuses = {"pending", "queued", "dispatched", "awaiting_approval", "blocked"}
    open_tasks = [
        task for task in tasks
        if getattr(task.status, "value", task.status) in open_statuses
    ]
    open_keys = {task.key for task in open_tasks}
    schedule = compute_cpm(
        [
            CPMTask(
                key=task.key,
                remaining_days=get_remaining_days(task.status, task.duration_days, task.dispatched_day, current_day),
                deps=[dep for dep in task.depends_on_list if dep in open_keys],
            )
            for task in open_tasks
        ],
        hire.start_day - current_day,
    )
    schedule_by_key = {task.key: task for task in schedule}
    return [
        TaskOut(
            id=UUID(t.public_id),
            key=t.key,
            title=t.title,
            team=t.team,
            duration_days=t.duration_days,
            depends_on=t.depends_on_list,
            status=t.status,
            ticket_id=t.ticket_id,
            slack=t.slack,
            critical=t.critical,
            flag=t.flag,
            dispatched_day=t.dispatched_day,
            remaining_days=get_remaining_days(t.status, t.duration_days, t.dispatched_day, current_day),
            schedule_start_day=(current_day + schedule_by_key[t.key].es) if t.key in schedule_by_key else None,
            schedule_finish_day=(current_day + schedule_by_key[t.key].ef) if t.key in schedule_by_key else None,
            current_day=current_day,
        )
        for t in tasks
    ]


def _get_editable_hire(hire_id: UUID, session: Session) -> Hire:
    hire = _hire_by_public_id(hire_id, session)
    if hire is None:
        raise HTTPException(404, "Hire not found")
    return hire


@router.post("/{hire_id}/pause")
def pause_hire(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("HR"))):
    hire = _get_editable_hire(hire_id, session)
    internal_hire_id = hire.id
    if hire.status == HireStatus.cancelled:
        raise HTTPException(409, "A cancelled hire cannot be paused")
    if hire.status == HireStatus.ready:
        raise HTTPException(409, "A ready hire does not need to be paused")
    remaining = session.exec(select(Task).where(Task.hire_id == internal_hire_id, Task.status.not_in([TaskStatus.done, TaskStatus.cancelled, TaskStatus.paused]))).first()
    if hire.status == HireStatus.paused and remaining is None:
        return {"status": "paused", "hire_id": hire.public_id}

    failures: list[str] = []
    for task in session.exec(select(Task).where(Task.hire_id == internal_hire_id)).all():
        if task.status in (TaskStatus.done, TaskStatus.cancelled, TaskStatus.paused):
            continue
        if task.ticket_id:
            external = mcp_cancel_ticket(task.ticket_id)
            if external.get("error"):
                failures.append(task.ticket_id)
                continue
            ticket = session.exec(select(Ticket).where(Ticket.ticket_id == task.ticket_id)).first()
            if ticket:
                ticket.status = "cancelled"
                ticket.updated_at = datetime.utcnow()
                session.add(ticket)
        task.status = TaskStatus.paused
        session.add(task)

    for item in session.exec(select(OutboxItem).where(OutboxItem.hire_id == internal_hire_id)).all():
        session.delete(item)
    audit(session, internal_hire_id, f"Onboarding paused by {user.name}; open tickets were cancelled", "warning", f"user:{user.id}")
    hire.status = HireStatus.paused
    session.add(hire)
    session.commit()
    if failures:
        raise HTTPException(503, f"ITSM could not cancel {len(failures)} ticket(s). Retry to finish pausing this hire.")
    return {"status": "paused", "hire_id": hire.public_id}


@router.post("/{hire_id}/resume")
def resume_hire(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("HR"))):
    hire = _get_editable_hire(hire_id, session)
    internal_hire_id = hire.id
    if hire.status != HireStatus.paused:
        raise HTTPException(409, "Only a paused hire can be resumed")
    current_day = get_current_day(session)
    failures: list[str] = []
    for task in session.exec(select(Task).where(Task.hire_id == internal_hire_id, Task.status == TaskStatus.paused)).all():
        if task.ticket_id:
            external = mcp_update_ticket_status(task.ticket_id, "open")
            if external.get("error"):
                failures.append(task.ticket_id)
                continue
            ticket = session.exec(select(Ticket).where(Ticket.ticket_id == task.ticket_id)).first()
            if ticket:
                ticket.status = "open"
                ticket.updated_at = datetime.utcnow()
                session.add(ticket)
            task.status = TaskStatus.dispatched
            task.dispatched_day = current_day
            task.last_activity_day = current_day
        else:
            task.status = TaskStatus.pending
            task.needs_approval = False
        session.add(task)

    audit(session, internal_hire_id, f"Onboarding resumed by {user.name}", "info", f"user:{user.id}")
    if not failures:
        hire.status = HireStatus.on_track
    session.add(hire)
    session.commit()
    if failures:
        raise HTTPException(503, f"ITSM could not reopen {len(failures)} ticket(s). Retry to finish resuming this hire.")
    return {"status": "on_track", "hire_id": hire.public_id}


@router.post("/{hire_id}/cancel")
def cancel_hire(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("HR"))):
    hire = _get_editable_hire(hire_id, session)
    internal_hire_id = hire.id
    if hire.status == HireStatus.ready:
        raise HTTPException(409, "A ready hire cannot be cancelled")
    remaining = session.exec(select(Task).where(Task.hire_id == internal_hire_id, Task.status.not_in([TaskStatus.done, TaskStatus.cancelled]))).first()
    if hire.status == HireStatus.cancelled and remaining is None:
        return {"status": "cancelled", "hire_id": hire.public_id}

    failures: list[str] = []
    for task in session.exec(select(Task).where(Task.hire_id == internal_hire_id)).all():
        if task.status in (TaskStatus.done, TaskStatus.cancelled):
            continue
        if task.ticket_id:
            external = mcp_cancel_ticket(task.ticket_id)
            if external.get("error"):
                failures.append(task.ticket_id)
                continue
            ticket = session.exec(select(Ticket).where(Ticket.ticket_id == task.ticket_id)).first()
            if ticket:
                ticket.status = "cancelled"
                ticket.updated_at = datetime.utcnow()
                session.add(ticket)
        task.status = TaskStatus.cancelled
        session.add(task)

    for item in session.exec(select(OutboxItem).where(OutboxItem.hire_id == internal_hire_id)).all():
        session.delete(item)
    audit(session, internal_hire_id, f"Onboarding cancelled by {user.name}; open tickets were cancelled", "warning", f"user:{user.id}")
    hire.status = HireStatus.cancelled
    session.add(hire)
    session.commit()
    if failures:
        raise HTTPException(503, f"ITSM could not cancel {len(failures)} ticket(s). Retry to finish cancelling this hire.")
    return {"status": "cancelled", "hire_id": hire.public_id}


@router.get("/{hire_id}/audit")
def get_hire_audit(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if hire is None:
        raise HTTPException(404, "Hire not found")
    events = session.exec(
        select(AuditEvent)
        .where(AuditEvent.hire_id == hire.id)
        .order_by(AuditEvent.created_at)
    ).all()
    return [
        {
            "id": e.public_id,
            "day": e.day,
            "level": e.level,
            "message": e.message,
            "actor": e.actor_agent,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.post("/{hire_id}/what-if")
def what_if(hire_id: UUID, data: WhatIfRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if hire is None:
        raise HTTPException(404, "Hire not found")
    open_statuses = ("pending", "queued", "dispatched", "awaiting_approval")
    current_day = get_current_day(session)
    open_tasks = session.exec(select(Task).where(Task.hire_id == hire.id, Task.status.in_(open_statuses))).all()
    done_keys = {task.key for task in session.exec(select(Task).where(Task.hire_id == hire.id, Task.status == "done")).all()}
    cpm_tasks = [
        CPMTask(
            key=task.key,
            remaining_days=get_remaining_days(task.status, task.duration_days, task.dispatched_day, current_day),
            deps=[dependency for dependency in task.depends_on_list if dependency not in done_keys],
        )
        for task in open_tasks
    ]
    try:
        result = compute_what_if(cpm_tasks, hire.start_day - current_day, data.task_key, data.delay_days, current_day)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {**result, "tasks": [task.__dict__ for task in result["tasks"]]}


@router.get("/{hire_id}/explain")
def explain_risk(hire_id: UUID, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    hire = _hire_by_public_id(hire_id, session)
    if not hire:
        raise HTTPException(404, "Hire not found")

    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    critical = [t for t in tasks if t.critical]
    stalled = [t for t in tasks if t.flag in ("escalated", "watch", "rescheduled")]

    from app.config import settings
    if settings.GEMINI_API_KEY:
        try:
            import google.genai as genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            prompt = (
                f"Explain in 2-3 plain English sentences why hire '{hire.name}' "
                f"(role: {hire.role}) is {'at risk' if hire.status == 'at_risk' else hire.status} "
                f"for Day-1 readiness. "
                f"Status: {hire.status}, Readiness: {hire.readiness}%. "
                f"Critical tasks: {[t.title for t in critical]}. "
                f"Stalled/flagged tasks: {[t.title for t in stalled]}. "
                f"Days until start: {hire.start_day}."
            )
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt + " Return JSON with one `explanation` string. Do not make decisions or add unsupported facts.",
                config={"response_mime_type": "application/json", "response_schema": RiskExplanation},
            )
            parsed = RiskExplanation.model_validate_json(response.text or "")
            return {"explanation": parsed.explanation, "source": "llm"}
        except Exception:
            pass

    # Template fallback
    if hire.status == "at_risk":
        crit_names = ", ".join(t.title for t in critical[:3]) or "unknown"
        stall_names = ", ".join(t.title for t in stalled[:2])
        explanation = (
            f"{hire.name} is at risk of missing Day-1 (start day {hire.start_day}). "
            f"Critical-path tasks: {crit_names}. "
            + (f"Stalled items: {stall_names}." if stall_names else "")
        )
    elif hire.status == "ready":
        explanation = f"{hire.name} is fully ready — all tasks complete ({hire.readiness}%)."
    else:
        crit_names = ", ".join(t.title for t in critical[:2]) or "none"
        explanation = (
            f"{hire.name} is on track with {hire.readiness}% tasks completed. "
            f"Active critical-path tasks: {crit_names}."
        )
    return {"explanation": explanation, "source": "template"}
