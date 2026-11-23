from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.db.database import get_session
from app.domain.models import Hire, Task, AuditEvent, User
from app.services.orchestrator import create_hire_with_plan, get_current_day
from app.auth import require_roles
from app.services.cpm import CPMTask, compute_what_if, get_remaining_days
from app.services.planner import try_llm_plan
from pydantic import BaseModel, Field
from typing import Optional, List


router = APIRouter(prefix="/hires", tags=["hires"])


class HireCreate(BaseModel):
    name: str
    role: str
    department: str
    start_day: int
    manager_id: Optional[int] = None


class PlanPreviewRequest(BaseModel):
    role: str = Field(min_length=1, max_length=120)


class WhatIfRequest(BaseModel):
    task_key: str
    delay_days: int = Field(ge=0, le=10)


class RiskExplanation(BaseModel):
    explanation: str = Field(min_length=8, max_length=700)


class TaskOut(BaseModel):
    id: int
    key: str
    title: str
    team: str
    duration_days: int
    depends_on: List[str]
    needs_approval: bool
    approval_state: str
    status: str
    ticket_id: Optional[str]
    slack: Optional[float]
    critical: bool
    flag: str


class HireOut(BaseModel):
    id: int
    name: str
    role: str
    department: str
    start_day: int
    status: str
    readiness: float
    projected_day: Optional[int]
    manager_id: Optional[int] = None


@router.post("/plan-preview")
def plan_preview(data: PlanPreviewRequest, _user=Depends(require_roles("ADMIN", "HR"))):
    from app.config import settings
    plan = try_llm_plan(data.role, hire_id=0, api_key=settings.GEMINI_API_KEY)
    return {"role": data.role, "tasks": [task.model_dump() for task in plan.tasks]}


def _hire_out(h: Hire) -> HireOut:
    return HireOut(
        id=h.id,
        name=h.name,
        role=h.role,
        department=h.department,
        start_day=h.start_day,
        status=h.status,
        readiness=h.readiness,
        projected_day=h.projected_day,
        manager_id=h.manager_id,
    )


@router.post("", response_model=HireOut)
def create_hire(data: HireCreate, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    if data.manager_id is not None and session.get(User, data.manager_id) is None:
        raise HTTPException(422, "Manager not found")
    hire = create_hire_with_plan(session, data.name, data.role, data.department, data.start_day, data.manager_id)
    return _hire_out(hire)


@router.get("", response_model=List[HireOut])
def list_hires(session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    query = select(Hire)
    if user.role == "MANAGER":
        query = query.where(Hire.manager_id == user.id)
    hires = session.exec(query).all()
    return [_hire_out(h) for h in hires]


@router.get("/{hire_id}", response_model=HireOut)
def get_hire(hire_id: int, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    hire = session.get(Hire, hire_id)
    if not hire:
        raise HTTPException(404, "Hire not found")
    if user.role == "MANAGER" and hire.manager_id != user.id:
        raise HTTPException(404, "Hire not found")
    return _hire_out(hire)


@router.get("/{hire_id}/tasks", response_model=List[TaskOut])
def get_hire_tasks(hire_id: int, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    hire = session.get(Hire, hire_id)
    if hire is None or (user.role == "MANAGER" and hire.manager_id != user.id):
        raise HTTPException(404, "Hire not found")
    tasks = session.exec(select(Task).where(Task.hire_id == hire_id)).all()
    return [
        TaskOut(
            id=t.id,
            key=t.key,
            title=t.title,
            team=t.team,
            duration_days=t.duration_days,
            depends_on=t.depends_on_list,
            needs_approval=t.needs_approval,
            approval_state=t.approval_state,
            status=t.status,
            ticket_id=t.ticket_id,
            slack=t.slack,
            critical=t.critical,
            flag=t.flag,
        )
        for t in tasks
    ]


@router.get("/{hire_id}/audit")
def get_hire_audit(hire_id: int, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    hire = session.get(Hire, hire_id)
    if hire is None or (user.role == "MANAGER" and hire.manager_id != user.id):
        raise HTTPException(404, "Hire not found")
    events = session.exec(
        select(AuditEvent)
        .where(AuditEvent.hire_id == hire_id)
        .order_by(AuditEvent.created_at)
    ).all()
    return [
        {
            "id": e.id,
            "day": e.day,
            "level": e.level,
            "message": e.message,
            "actor": e.actor_agent,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.post("/{hire_id}/what-if")
def what_if(hire_id: int, data: WhatIfRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    hire = session.get(Hire, hire_id)
    if hire is None or (user.role == "MANAGER" and hire.manager_id != user.id):
        raise HTTPException(404, "Hire not found")
    open_statuses = ("pending", "queued", "dispatched", "awaiting_approval")
    current_day = get_current_day(session)
    open_tasks = session.exec(select(Task).where(Task.hire_id == hire_id, Task.status.in_(open_statuses))).all()
    done_keys = {task.key for task in session.exec(select(Task).where(Task.hire_id == hire_id, Task.status == "done")).all()}
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
def explain_risk(hire_id: int, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "MANAGER"))):
    hire = session.get(Hire, hire_id)
    if not hire:
        raise HTTPException(404, "Hire not found")
    if user.role == "MANAGER" and hire.manager_id != user.id:
        raise HTTPException(404, "Hire not found")

    tasks = session.exec(select(Task).where(Task.hire_id == hire_id)).all()
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
