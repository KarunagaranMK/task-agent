from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, delete
from app.db.database import get_session
from app.domain.models import (
    SimState, Hire, Task, Ticket, TicketComment, OutboxItem, AuditEvent, Notification, ExperimentRun, SecurityAudit,
)
from app.services.orchestrator import advance_day, monitor_tick, get_or_create_sim_state
from app.services.experiment import run_experiment
from app.auth import get_current_user, in_app_notifications_enabled, require_roles
from app.config import settings
from app.mcp_clients.tools import reset_mcp_services, set_itsm_offline
from app.services.clock import load_clock
from pydantic import BaseModel, Field
import json
from typing import Optional
from uuid import UUID


router = APIRouter(tags=["sim"])


@router.post("/sim/advance")
def sim_advance(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    day = advance_day(session)
    monitor_tick(session)
    return {"current_day": day, "message": f"Advanced to day {day} and ran monitor"}


@router.post("/monitor/tick")
def manual_tick(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    monitor_tick(session)
    state = get_or_create_sim_state(session)
    return {"message": "Monitor tick complete", "current_day": state.current_day}


@router.post("/chaos/itsm")
def toggle_itsm(offline: bool, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    state = get_or_create_sim_state(session)
    previous = state.itsm_offline
    state.itsm_offline = offline
    session.add(state)
    if previous != offline:
        session.add(SecurityAudit(actor_id=user.id, action="itsm_outage_started" if offline else "itsm_recovered",
                                  target="mock-itsm"))
    session.commit()
    set_itsm_offline(offline)
    return {"itsm_offline": offline}


class ExperimentRequest(BaseModel):
    n_hires: int = Field(default=200, ge=10, le=1000)
    stall_probability: float = Field(default=0.2, ge=0, le=1)
    seed: int = Field(default=42, ge=0, le=999999)


@router.post("/experiments/run")
def run_exp(req: ExperimentRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    result = run_experiment(req.n_hires, req.stall_probability, req.seed)
    session.add(ExperimentRun(parameters_json=json.dumps(req.model_dump()), result_json=json.dumps(result)))
    session.add(AuditEvent(day=get_or_create_sim_state(session).current_day, hire_id=0,
                           level="info", message="Readiness experiment completed", actor_agent=f"user:{user.id}"))
    session.commit()
    return result


@router.get("/metrics")
def get_metrics(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    hires = session.exec(select(Hire).where(Hire.archived.is_(False))).all()
    total = len(hires)
    ready = sum(1 for h in hires if h.status == "ready")
    at_risk = sum(1 for h in hires if h.status == "at_risk")

    escalations = session.exec(
        select(AuditEvent).where(AuditEvent.level == "critical")
    ).all()
    rescheduled = session.exec(
        select(Task).where(Task.flag == "rescheduled")
    ).all()
    outbox_count = len(session.exec(select(OutboxItem)).all())
    ready_durations = [(hire.ready_at - hire.created_at).total_seconds() / 86400
                       for hire in hires if hire.ready_at is not None]
    approvals = session.exec(select(Task).where(Task.approval_requested_at.is_not(None),
                                                Task.approval_decided_at.is_not(None))).all()
    approval_minutes = [(task.approval_decided_at - task.approval_requested_at).total_seconds() / 60
                        for task in approvals if task.approval_decided_at and task.approval_requested_at]
    recoveries = session.exec(select(SecurityAudit).where(SecurityAudit.action == "itsm_recovered")).all()

    state = get_or_create_sim_state(session)
    ready_starting_soon = sum(1 for hire in hires if hire.status == "ready" and 0 <= hire.start_day - state.current_day <= 7)
    clock = load_clock(session, state.current_day)
    organization_today = clock.today()
    return {
        "current_day": state.current_day,
        "current_date": organization_today.isoformat(),
        "earliest_joining_date": clock.calendar.add_business_days(organization_today, 1).isoformat(),
        "default_joining_date": clock.calendar.add_business_days(organization_today, 8).isoformat(),
        "itsm_offline": state.itsm_offline,
        "total_hires": total,
        "ready_hires": ready,
        "at_risk_hires": at_risk,
        "on_track_hires": total - ready - at_risk,
        "ready_starting_soon": ready_starting_soon,
        "day1_readiness_pct": round(ready / total * 100, 1) if total else 0.0,
        "escalations": len(escalations),
        "stalls_rescued": len(rescheduled),
        "outbox_pending": outbox_count,
        "average_time_to_ready_days": round(sum(ready_durations) / len(ready_durations), 1) if ready_durations else None,
        "approval_latency_minutes": round(sum(approval_minutes) / len(approval_minutes), 1) if approval_minutes else None,
        "outages_recovered": len(recoveries),
    }


def _notifications_for_user(session: Session, user) -> list[Notification]:
    query = select(Notification)
    if user.role == "MANAGER":
        query = query.where(Notification.for_role == "Manager")
    elif user.role == "IT_STAFF":
        team_name = "Facilities" if (user.team or "").lower() == "facilities" else "IT"
        query = query.where(Notification.for_role == team_name)
    elif user.role == "NEW_HIRE":
        query = query.where(Notification.for_role == "New Hire")
    notifications = session.exec(query.order_by(Notification.created_at.desc())).all()
    if user.role == "MANAGER":
        notifications = [
            n for n in notifications
            if n.hire_id is None or (session.get(Hire, n.hire_id) is not None and session.get(Hire, n.hire_id).manager_id == user.id)
        ]
    elif user.role == "NEW_HIRE":
        notifications = [
            n for n in notifications if n.hire_id is not None
            and session.exec(select(Hire.id).where(Hire.id == n.hire_id, Hire.new_hire_user_id == user.id)).first()
        ]
    return notifications


@router.get("/notifications")
def get_notifications(role: Optional[str] = None, session: Session = Depends(get_session), user=Depends(get_current_user)):
    if not in_app_notifications_enabled(session, user):
        return []
    notifications = _notifications_for_user(session, user)
    return [
        {
            "id": n.public_id,
            "for_role": n.for_role,
            "message": n.message,
            "hire_id": (
                hire.public_id if n.hire_id is not None and (hire := session.get(Hire, n.hire_id)) else None
            ),
            "task_id": (
                task.public_id if n.task_id is not None and (task := session.get(Task, n.task_id)) else None
            ),
            "read": n.read,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifications
    ]


@router.post("/notifications/{nid}/read")
def mark_read(nid: UUID, session: Session = Depends(get_session), user=Depends(get_current_user)):
    n = session.exec(select(Notification).where(Notification.public_id == str(nid))).first()
    own_role = user.team if user.role == "IT_STAFF" else user.role
    if n is None:
        raise HTTPException(404, "Notification not found")
    permitted = n.for_role.lower() in {own_role.lower(), user.role.lower(), "new hire" if user.role == "NEW_HIRE" else ""}
    if user.role == "MANAGER" and n.hire_id is not None:
        hire = session.get(Hire, n.hire_id)
        permitted = permitted and hire is not None and hire.manager_id == user.id
    if user.role == "NEW_HIRE" and n.hire_id is not None:
        permitted = permitted and session.exec(select(Hire.id).where(Hire.id == n.hire_id, Hire.new_hire_user_id == user.id)).first() is not None
    if user.role not in {"ADMIN", "HR"} and not permitted:
        raise HTTPException(403, "Notification belongs to another role")
    n.read = True
    session.add(n)
    session.commit()
    return {"id": n.public_id, "read": True}


@router.post("/notifications/read-all")
def mark_all_read(session: Session = Depends(get_session), user=Depends(get_current_user)):
    notifications = _notifications_for_user(session, user)
    for item in notifications:
        item.read = True
        session.add(item)
    session.commit()
    return {"updated": len(notifications)}


@router.post("/reset")
def reset_all(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN"))):
    """Reset all data for a clean demo."""
    for model in (AuditEvent, Notification, OutboxItem, TicketComment, Ticket, Task, Hire, SimState, ExperimentRun):
        session.exec(delete(model))
    session.commit()
    reset_mcp_services()
    if settings.DEMO_MODE:
        from app.services.orchestrator import create_hire_with_plan, monitor_tick
        from app.domain.models import User
        manager = session.exec(select(User).where(User.email == "manager@demo.local")).first()
        new_hire = session.exec(select(User).where(User.email == "newhire@demo.local")).first()
        manager_id = manager.id if manager else None
        priya = create_hire_with_plan(session, "Priya Sharma", "Data Analyst", "Analytics", 8, manager_id)
        if new_hire:
            priya.new_hire_user_id = new_hire.id
            session.add(priya)
            session.commit()
        create_hire_with_plan(session, "Alex Chen", "Software Engineer", "Engineering", 10, manager_id)
        create_hire_with_plan(session, "Maria Garcia", "default", "Marketing", 6, manager_id)
        monitor_tick(session)
        return {"message": "Demo reset to Priya scenario", "hire_id": priya.public_id}
    return {"message": "Simulation data reset"}
