from fastapi import APIRouter, Depends
from sqlmodel import Session, select, delete
from app.db.database import get_session
from app.domain.models import (
    SimState, Hire, Task, Ticket, OutboxItem, AuditEvent, Notification,
)
from app.services.orchestrator import advance_day, monitor_tick, get_or_create_sim_state
from app.services.experiment import run_experiment
from pydantic import BaseModel
from typing import Optional


router = APIRouter(tags=["sim"])


@router.post("/sim/advance")
def sim_advance(session: Session = Depends(get_session)):
    day = advance_day(session)
    monitor_tick(session)
    return {"current_day": day, "message": f"Advanced to day {day} and ran monitor"}


@router.post("/monitor/tick")
def manual_tick(session: Session = Depends(get_session)):
    monitor_tick(session)
    state = get_or_create_sim_state(session)
    return {"message": "Monitor tick complete", "current_day": state.current_day}


@router.post("/chaos/itsm")
def toggle_itsm(offline: bool, session: Session = Depends(get_session)):
    state = get_or_create_sim_state(session)
    state.itsm_offline = offline
    session.add(state)
    session.commit()
    return {"itsm_offline": offline}


class ExperimentRequest(BaseModel):
    n_hires: int = 200
    stall_probability: float = 0.2
    seed: int = 42


@router.post("/experiments/run")
def run_exp(req: ExperimentRequest):
    return run_experiment(req.n_hires, req.stall_probability, req.seed)


@router.get("/metrics")
def get_metrics(session: Session = Depends(get_session)):
    hires = session.exec(select(Hire)).all()
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

    state = get_or_create_sim_state(session)
    return {
        "current_day": state.current_day,
        "itsm_offline": state.itsm_offline,
        "total_hires": total,
        "ready_hires": ready,
        "at_risk_hires": at_risk,
        "on_track_hires": total - ready - at_risk,
        "day1_readiness_pct": round(ready / total * 100, 1) if total else 0.0,
        "escalations": len(escalations),
        "stalls_rescued": len(rescheduled),
        "outbox_pending": outbox_count,
    }


@router.get("/notifications")
def get_notifications(role: Optional[str] = None, session: Session = Depends(get_session)):
    query = select(Notification)
    if role:
        query = query.where(Notification.for_role == role)
    notifications = session.exec(query.order_by(Notification.created_at.desc())).all()
    return [
        {
            "id": n.id,
            "for_role": n.for_role,
            "message": n.message,
            "hire_id": n.hire_id,
            "task_id": n.task_id,
            "read": n.read,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifications
    ]


@router.post("/notifications/{nid}/read")
def mark_read(nid: int, session: Session = Depends(get_session)):
    n = session.get(Notification, nid)
    if n:
        n.read = True
        session.add(n)
        session.commit()
    return {"id": nid, "read": True}


@router.post("/reset")
def reset_all(session: Session = Depends(get_session)):
    """Reset all data for a clean demo."""
    for model in (AuditEvent, Notification, OutboxItem, Ticket, Task, Hire, SimState):
        session.exec(delete(model))
    session.commit()
    return {"message": "All data reset"}
