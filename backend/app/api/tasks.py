from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.db.database import get_session
from app.domain.models import Task, TaskStatus, ApprovalState, Ticket
from app.services.orchestrator import audit, notify, get_current_day
from app.auth import require_roles
from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status


router = APIRouter(tags=["tasks"])


@router.post("/tasks/{task_id}/approve")
def approve_task(task_id: int, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "MANAGER"))):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.approval_state = ApprovalState.approved
    task.status = TaskStatus.pending
    session.add(task)
    audit(session, task.hire_id, f"Manager approved '{task.title}'", "info", "approval_gate")
    session.commit()
    return {"status": "approved", "task_id": task_id}


@router.post("/tasks/{task_id}/reject")
def reject_task(task_id: int, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "MANAGER"))):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.approval_state = ApprovalState.rejected
    task.status = TaskStatus.blocked
    session.add(task)
    audit(session, task.hire_id, f"Manager rejected '{task.title}'", "warning", "approval_gate")
    session.commit()
    return {"status": "rejected", "task_id": task_id}


@router.get("/tickets")
def list_tickets(session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    query = select(Ticket)
    if user.role != "ADMIN":
        query = query.where(Ticket.team == user.team)
    tickets = session.exec(query).all()
    return [
        {
            "id": t.id,
            "ticket_id": t.ticket_id,
            "title": t.title,
            "team": t.team,
            "status": t.status,
            "hire_id": t.hire_id,
            "task_id": t.task_id,
            "estimate_days": t.estimate_days,
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]


@router.post("/tickets/{ticket_id}/complete")
def complete_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == ticket_id)).first()
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if user.role != "ADMIN" and ticket.team != user.team:
        raise HTTPException(403, "Ticket belongs to another team")
    external = mcp_update_ticket_status(ticket_id, "done")
    if external.get("error") == "service_unavailable":
        raise HTTPException(503, "ITSM service is unavailable")
    if external.get("error"):
        raise HTTPException(502, "ITSM service could not update the ticket")
    ticket.status = "done"
    session.add(ticket)

    if ticket.task_id:
        task = session.get(Task, ticket.task_id)
        if task:
            task.status = TaskStatus.done
            task.last_activity_day = get_current_day(session)
            session.add(task)
            audit(session, task.hire_id, f"Task '{task.title}' completed", "info", "it_provisioner")

    session.commit()
    return {"ticket_id": ticket_id, "status": "done"}


@router.post("/tickets/{ticket_id}/stall")
def stall_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == ticket_id)).first()
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if user.role != "ADMIN" and ticket.team != user.team:
        raise HTTPException(403, "Ticket belongs to another team")
    external = mcp_update_ticket_status(ticket_id, "stalled")
    if external.get("error") == "service_unavailable":
        raise HTTPException(503, "ITSM service is unavailable")
    ticket.status = "stalled"
    session.add(ticket)
    # Do NOT update last_activity_day — that triggers stall detection
    session.commit()
    return {"ticket_id": ticket_id, "status": "stalled"}
