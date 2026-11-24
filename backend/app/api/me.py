"""Privacy-filtered self-service onboarding endpoints for new hires."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.auth import require_roles
from app.db.database import get_session
from app.domain.models import Hire, Notification, SimState, Task, User

router = APIRouter(prefix="/me", tags=["my onboarding"])


class IssueRequest(BaseModel):
    message: str = Field(min_length=8, max_length=500)


@router.get("/onboarding")
def my_onboarding(session: Session = Depends(get_session), user: User = Depends(require_roles("NEW_HIRE"))):
    hire = session.exec(select(Hire).where(Hire.new_hire_user_id == user.id)).first()
    if hire is None:
        return {"hire": None, "tasks": []}
    current_day = session.exec(select(SimState.current_day).limit(1)).first() or 0
    tasks = session.exec(select(Task).where(Task.hire_id == hire.id)).all()
    return {
        "hire": {
            "name": hire.name,
            "role": hire.role,
            "department": hire.department,
            "start_day": hire.start_day,
            "status": hire.status,
            "readiness": hire.readiness,
            "projected_day": hire.projected_day,
        },
        "tasks": [
            {
                "title": task.title,
                "status": task.status,
                "eta_day": None if task.status == "done" else min(
                    hire.start_day,
                    (task.dispatched_day if task.dispatched_day is not None else current_day) + task.duration_days,
                ),
            }
            for task in tasks
        ],
    }


@router.post("/issues", status_code=201)
def report_issue(data: IssueRequest, session: Session = Depends(get_session), user: User = Depends(require_roles("NEW_HIRE"))):
    hire = session.exec(select(Hire).where(Hire.new_hire_user_id == user.id)).first()
    if hire is None:
        raise HTTPException(409, "Your onboarding plan is not linked yet")
    notification = Notification(
        for_role="HR",
        hire_id=hire.id,
        message=f"New-hire issue from {hire.name}: {data.message.strip()}",
    )
    session.add(notification)
    session.commit()
    session.refresh(notification)
    return {"id": notification.id, "received": True}
