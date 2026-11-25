from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from app.db.database import get_session
from app.domain.models import Hire, Task, TaskStatus, ApprovalState, Ticket, TicketComment, User
from app.services.orchestrator import audit, get_current_day
from app.auth import require_roles
from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status


router = APIRouter(tags=["tasks"])


class TicketCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


def _get_team_ticket(session: Session, ticket_id: str, user) -> Ticket:
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == ticket_id)).first()
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    if user.role != "ADMIN" and ticket.team != user.team:
        raise HTTPException(403, "Ticket belongs to another team")
    return ticket


def _sync_ticket_status(ticket: Ticket, status: str, session: Session, user) -> None:
    external = mcp_update_ticket_status(ticket.ticket_id, status)
    if external.get("error") == "service_unavailable":
        raise HTTPException(503, "ITSM service is unavailable")
    if external.get("error"):
        raise HTTPException(502, "ITSM service could not update the ticket")
    ticket.status = status
    session.add(ticket)
    if ticket.task_id:
        task = session.get(Task, ticket.task_id)
        if task:
            if status == "in_progress":
                task.status = TaskStatus.dispatched
            elif status == "blocked":
                task.status = TaskStatus.blocked
            elif status == "stalled":
                task.status = TaskStatus.dispatched
            # A stalled ticket stays open to the monitor's stall detector. Marking its
            # task blocked here would hide it from recovery and fallback processing.
            if status == "in_progress":
                task.last_activity_day = get_current_day(session)
            session.add(task)
            audit(session, task.hire_id, f"Task '{task.title}' marked {status.replace('_', ' ')}", "warning" if status in {"blocked", "stalled"} else "info", f"user:{user.id}")


@router.post("/tasks/{task_id}/approve")
def approve_task(task_id: int, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "MANAGER"))):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    hire = session.get(Hire, task.hire_id)
    if _user.role == "MANAGER" and (hire is None or hire.manager_id != _user.id):
        raise HTTPException(404, "Task not found")
    task.approval_state = ApprovalState.approved
    task.status = TaskStatus.pending
    task.approval_decided_at = datetime.utcnow()
    session.add(task)
    audit(session, task.hire_id, f"Manager approved '{task.title}'", "info", f"user:{_user.id}")
    session.commit()
    return {"status": "approved", "task_id": task_id}


@router.post("/tasks/{task_id}/reject")
def reject_task(task_id: int, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "MANAGER"))):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    hire = session.get(Hire, task.hire_id)
    if _user.role == "MANAGER" and (hire is None or hire.manager_id != _user.id):
        raise HTTPException(404, "Task not found")
    task.approval_state = ApprovalState.rejected
    task.status = TaskStatus.blocked
    task.approval_decided_at = datetime.utcnow()
    session.add(task)
    audit(session, task.hire_id, f"Manager rejected '{task.title}'", "warning", f"user:{_user.id}")
    session.commit()
    return {"status": "rejected", "task_id": task_id}


@router.post("/tasks/{task_id}/undo-approval")
def undo_approval(task_id: int, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "MANAGER"))):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    hire = session.get(Hire, task.hire_id)
    if user.role == "MANAGER" and (hire is None or hire.manager_id != user.id):
        raise HTTPException(404, "Task not found")
    if task.approval_state not in {ApprovalState.approved, ApprovalState.rejected}:
        raise HTTPException(409, "This approval can no longer be undone")
    task.approval_state = ApprovalState.pending
    task.status = TaskStatus.awaiting_approval
    task.approval_decided_at = None
    session.add(task)
    audit(session, task.hire_id, f"Approval for '{task.title}' was undone", "info", f"user:{user.id}")
    session.commit()
    return {"status": "awaiting_approval", "task_id": task_id}


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
            "hire_id": (hire.public_id if (hire := session.get(Hire, t.hire_id)) else None),
            "task_id": t.task_id,
            "estimate_days": t.estimate_days,
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]


@router.post("/tickets/{ticket_id}/complete")
def complete_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
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
            audit(session, task.hire_id, f"Task '{task.title}' completed", "info", f"user:{user.id}")

    session.commit()
    return {"ticket_id": ticket_id, "status": "done"}


@router.post("/tickets/{ticket_id}/start")
def start_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status == "done":
        raise HTTPException(409, "Completed tickets cannot be restarted")
    _sync_ticket_status(ticket, "in_progress", session, user)
    session.commit()
    return {"ticket_id": ticket_id, "status": "in_progress"}


@router.post("/tickets/{ticket_id}/block")
def block_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status == "done":
        raise HTTPException(409, "Completed tickets cannot be blocked")
    _sync_ticket_status(ticket, "blocked", session, user)
    session.commit()
    return {"ticket_id": ticket_id, "status": "blocked"}


@router.get("/tickets/{ticket_id}/comments")
def list_ticket_comments(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    comments = session.exec(select(TicketComment).where(TicketComment.ticket_id == ticket.id).order_by(TicketComment.created_at)).all()
    return [
        {"id": item.id, "author": (session.get(User, item.author_id).name if session.get(User, item.author_id) else "Team member"),
         "body": item.body, "created_at": item.created_at.isoformat()}
        for item in comments
    ]


@router.post("/tickets/{ticket_id}/comments", status_code=201)
def add_ticket_comment(ticket_id: str, data: TicketCommentRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    body = data.body.strip()
    if not body:
        raise HTTPException(422, "Comment cannot be empty")
    comment = TicketComment(ticket_id=ticket.id, author_id=user.id, body=body)
    session.add(comment)
    if ticket.hire_id:
        audit(session, ticket.hire_id, f"Comment added to {ticket.ticket_id}", "info", f"user:{user.id}")
    session.commit()
    session.refresh(comment)
    return {"id": comment.id, "author": user.name, "body": comment.body, "created_at": comment.created_at.isoformat()}


@router.post("/tickets/{ticket_id}/stall")
def stall_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    _sync_ticket_status(ticket, "stalled", session, user)
    # Do NOT update last_activity_day — that triggers stall detection
    session.commit()
    return {"ticket_id": ticket_id, "status": "stalled"}
