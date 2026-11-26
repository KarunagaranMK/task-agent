from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from app.db.database import get_session
from app.domain.models import AuditEvent, Hire, Task, TaskStatus, Ticket, TicketComment, User
from app.services.orchestrator import audit, get_current_day, monitor_tick, notify
from app.auth import require_roles
from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status


router = APIRouter(tags=["tasks"])


class TicketCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class HRReviewRequest(BaseModel):
    decision: str = Field(pattern="^(accept|alternative)$")


def _task_by_public_id(public_id: UUID, session: Session) -> Task | None:
    return session.exec(select(Task).where(Task.public_id == str(public_id))).first()


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


@router.get("/tickets")
def list_tickets(session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    query = select(Ticket)
    if user.role != "ADMIN":
        query = query.where(Ticket.team == user.team)
    tickets = session.exec(query).all()
    return [
        {
            "id": t.public_id,
            "ticket_id": t.ticket_id,
            "title": t.title,
            "team": t.team,
            "status": t.status,
            "hire_id": (hire.public_id if (hire := session.get(Hire, t.hire_id)) else None),
            "task_id": (task.public_id if t.task_id is not None and (task := session.get(Task, t.task_id)) else None),
            "estimate_days": t.estimate_days,
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]


@router.post("/tickets/{ticket_id}/complete")
def complete_ticket(ticket_id: str, data: TicketCommentRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    external = mcp_update_ticket_status(ticket_id, "done")
    if external.get("error") == "service_unavailable":
        raise HTTPException(503, "ITSM service is unavailable")
    if external.get("error"):
        raise HTTPException(502, "ITSM service could not update the ticket")
    ticket.status = "pending_review"
    session.add(ticket)
    session.add(TicketComment(ticket_id=ticket.id, author_id=user.id, body=data.body.strip()))

    if ticket.task_id:
        task = session.get(Task, ticket.task_id)
        if task:
            task.last_activity_day = get_current_day(session)
            session.add(task)
            hire = session.get(Hire, task.hire_id)
            hire_name = hire.name if hire else "the new hire"
            audit(session, task.hire_id, f"{user.team or ticket.team} submitted '{task.title}' for HR review", "info", f"user:{user.id}")
            notify(session, "HR", f"{ticket.team} submitted “{task.title}” for {hire_name}; review the completion.", task.hire_id, task.id)

    session.commit()
    return {"ticket_id": ticket_id, "status": "pending_review"}


@router.get("/tasks/hr-review")
def list_hr_reviews(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    tickets = session.exec(select(Ticket).where(Ticket.status.in_(["pending_review", "alternative_pending", "done"]))
                           .order_by(Ticket.updated_at.desc())).all()
    reviews = []
    for ticket in tickets:
        task = session.get(Task, ticket.task_id) if ticket.task_id else None
        hire = session.get(Hire, ticket.hire_id) if ticket.hire_id else None
        if task and hire:
            if ticket.status == "done":
                accepted_messages = {
                    f"HR accepted completion of '{task.title}' for {hire.name}.",
                    f"HR approved the alternative '{task.title}' for {hire.name}; {ticket.team} can continue the work.",
                }
                accepted = session.exec(select(AuditEvent).where(
                    AuditEvent.hire_id == hire.id, AuditEvent.message.in_(accepted_messages)
                )).first()
                if accepted is None:
                    continue
            notes = session.exec(select(TicketComment).where(TicketComment.ticket_id == ticket.id)
                                 .order_by(TicketComment.created_at.desc())).all()
            reviews.append({
                "task_id": task.public_id,
                "ticket_id": ticket.ticket_id,
                "hire_id": hire.public_id,
                "hire_name": hire.name,
                "task_title": task.title,
                "team": ticket.team,
                "status": ticket.status,
                "suggested_title": ticket.title if ticket.status == "alternative_pending" else None,
                "verification_notes": [
                    {"author": (session.get(User, note.author_id).name if session.get(User, note.author_id) else "Department teammate"),
                     "body": note.body, "created_at": note.created_at.isoformat()}
                    for note in notes
                ],
                "updated_at": ticket.updated_at.isoformat(),
            })
    return reviews


@router.post("/tasks/{task_id}/review")
def review_department_work(task_id: UUID, data: HRReviewRequest, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR"))):
    task = _task_by_public_id(task_id, session)
    if not task or not task.ticket_id:
        raise HTTPException(404, "Submitted task not found")
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == task.ticket_id)).first()
    hire = session.get(Hire, task.hire_id)
    if not ticket or not hire:
        raise HTTPException(404, "Submitted work not found")

    if data.decision == "accept":
        if ticket.status == "pending_review":
            ticket.status = "done"
            task.status = TaskStatus.done
            message = f"HR accepted completion of '{task.title}' for {hire.name}."
        elif ticket.status == "alternative_pending":
            from app.mcp_clients.tools import update_ticket_details as mcp_update_ticket_details
            from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status
            details = mcp_update_ticket_details(ticket.ticket_id, ticket.title, ticket.estimate_days)
            if details.get("error"):
                raise HTTPException(502, "ITSM could not update the approved alternative")
            reopened = mcp_update_ticket_status(ticket.ticket_id, "open")
            if reopened.get("error"):
                raise HTTPException(503, "ITSM could not reopen the approved alternative")
            task.title = ticket.title
            task.duration_days = ticket.estimate_days
            task.status = TaskStatus.dispatched
            task.dispatched_day = get_current_day(session)
            task.last_activity_day = get_current_day(session)
            ticket.status = "open"
            message = f"HR approved the alternative '{task.title}' for {hire.name}; {ticket.team} can continue the work."
        else:
            raise HTTPException(409, "This submission is no longer awaiting HR review")
        session.add(task)
        ticket.updated_at = datetime.utcnow()
        session.add(ticket)
        audit(session, task.hire_id, message, "info", f"user:{user.id}")
        notify(session, ticket.team, message, task.hire_id, task.id)
        session.commit()
        monitor_tick(session)
        return {"status": "accepted", "task_id": task.public_id}

    if ticket.status != "pending_review":
        raise HTTPException(409, "Only newly submitted work can request an alternative")
    from app.services.llm import draft_alternative_title
    suggestion = draft_alternative_title(task.title, hire.role, hire.department, task.fallback_title)
    ticket.title = suggestion["title"]
    ticket.estimate_days = suggestion["duration_days"]
    ticket.status = "alternative_pending"
    ticket.updated_at = datetime.utcnow()
    session.add(ticket)
    audit(session, task.hire_id, f"OnboardFlow suggested '{ticket.title}' as an alternative to '{task.title}'; HR approval is required", "warning", "agent:alternative_planner")
    notify(session, "HR", f"Agent alternative for {hire.name}: “{ticket.title}” is ready for your approval.", task.hire_id, task.id)
    session.commit()
    return {"status": "alternative_pending", "suggested_title": ticket.title, "duration_days": ticket.estimate_days}


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
        {"id": item.public_id, "author": (session.get(User, item.author_id).name if session.get(User, item.author_id) else "Team member"),
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
    return {"id": comment.public_id, "author": user.name, "body": comment.body, "created_at": comment.created_at.isoformat()}


@router.post("/tickets/{ticket_id}/stall")
def stall_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    _sync_ticket_status(ticket, "stalled", session, user)
    # Do NOT update last_activity_day — that triggers stall detection
    session.commit()
    return {"ticket_id": ticket_id, "status": "stalled"}
