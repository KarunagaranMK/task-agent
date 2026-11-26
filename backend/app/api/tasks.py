from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from sqlmodel import Session, select
from app.db.database import get_session
from app.domain.models import AlternativeRequest, AuditEvent, Hire, Task, TaskStatus, Ticket, TicketComment, User
from app.services.orchestrator import audit, get_current_day, monitor_tick, notify
from app.auth import require_roles
from app.mcp_clients.tools import update_ticket_details as mcp_update_ticket_details
from app.mcp_clients.tools import update_ticket_status as mcp_update_ticket_status
from app.services.alternatives import create_alternative_request, employee_display_id, pending_alternative, suggestion_for_task


router = APIRouter(tags=["tasks"])


class TicketCommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class HRReviewRequest(BaseModel):
    decision: str = Field(pattern="^(accept|alternative)$")


class AlternativeSuggestionRequest(BaseModel):
    issue: str = Field(min_length=8, max_length=1000)


class AlternativeSubmissionRequest(AlternativeSuggestionRequest):
    suggested_title: str = Field(min_length=4, max_length=160)
    suggested_days: int = Field(ge=1, le=30)


class AlternativeDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    note: str = Field(default="", max_length=500)


def _task_by_public_id(public_id: UUID, session: Session) -> Task | None:
    return session.exec(select(Task).where(Task.public_id == str(public_id))).first()


def _get_team_ticket(session: Session, ticket_id: str, user) -> Ticket:
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == ticket_id)).first()
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    team = "HR" if user.role == "HR" else user.team
    if user.role != "ADMIN" and ticket.team != team:
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
def list_tickets(session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "IT_STAFF"))):
    query = select(Ticket)
    if user.role == "HR":
        query = query.where(Ticket.team == "HR")
    elif user.role == "IT_STAFF":
        query = query.where(Ticket.team == user.team)
    tickets = session.exec(query).all()
    requests = session.exec(
        select(AlternativeRequest)
        .where(AlternativeRequest.ticket_id.in_([ticket.id for ticket in tickets]))
        .order_by(AlternativeRequest.created_at.desc())
    ).all() if tickets else []
    latest_request = {}
    for request in requests:
        latest_request.setdefault(request.ticket_id, request)
    return [
        {
            "id": t.public_id,
            "ticket_id": t.ticket_id,
            "title": t.title,
            "team": t.team,
            "status": t.status,
            "hire_id": (hire.public_id if (hire := session.get(Hire, t.hire_id)) else None),
            "employee_name": hire.name if hire else "Unknown employee",
            "employee_id": employee_display_id(hire.public_id) if hire else "Unknown ID",
            "task_id": (task.public_id if t.task_id is not None and (task := session.get(Task, t.task_id)) else None),
            "alternative": ({
                "id": latest_request[t.id].public_id,
                "issue": latest_request[t.id].issue,
                "suggested_title": latest_request[t.id].suggested_title,
                "suggested_days": latest_request[t.id].suggested_days,
                "status": latest_request[t.id].status,
                "decision_note": latest_request[t.id].decision_note,
            } if t.id in latest_request else None),
            "estimate_days": t.estimate_days,
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]


@router.post("/tickets/{ticket_id}/alternative-suggestion")
def suggest_ticket_alternative(
    ticket_id: str,
    data: AlternativeSuggestionRequest,
    session: Session = Depends(get_session),
    user=Depends(require_roles("HR", "IT_STAFF")),
):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status in {"done", "pending_review", "alternative_pending"}:
        raise HTTPException(409, "This request cannot be changed while it is completed or awaiting review")
    if ticket.task_id is None or ticket.hire_id is None:
        raise HTTPException(409, "This ticket is not linked to an onboarding task")
    task = session.get(Task, ticket.task_id)
    hire = session.get(Hire, ticket.hire_id)
    if task is None or hire is None:
        raise HTTPException(404, "The onboarding task or employee was not found")
    if pending_alternative(session, ticket.id):
        raise HTTPException(409, "An alternative for this request is already waiting for HR")
    recommendation = suggestion_for_task(task, hire, data.issue.strip())
    return {
        "ticket_id": ticket.ticket_id,
        "employee_name": hire.name,
        "employee_id": employee_display_id(hire.public_id),
        "issue": data.issue.strip(),
        "suggested_title": recommendation["title"],
        "suggested_days": recommendation["duration_days"],
    }


@router.post("/tickets/{ticket_id}/alternatives", status_code=201)
def submit_ticket_alternative(
    ticket_id: str,
    data: AlternativeSubmissionRequest,
    session: Session = Depends(get_session),
    user=Depends(require_roles("HR", "IT_STAFF")),
):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status in {"done", "pending_review", "alternative_pending"}:
        raise HTTPException(409, "This request cannot be changed while it is completed or awaiting review")
    if ticket.task_id is None or ticket.hire_id is None:
        raise HTTPException(409, "This ticket is not linked to an onboarding task")
    task = session.get(Task, ticket.task_id)
    hire = session.get(Hire, ticket.hire_id)
    if task is None or hire is None:
        raise HTTPException(404, "The onboarding task or employee was not found")
    if pending_alternative(session, ticket.id):
        raise HTTPException(409, "An alternative for this request is already waiting for HR")

    external = mcp_update_ticket_status(ticket.ticket_id, "blocked")
    if external.get("error"):
        raise HTTPException(503, "The ticket could not be paused while HR reviews the alternative")
    now = datetime.utcnow()
    ticket.status = "alternative_pending"
    ticket.updated_at = now
    task.status = TaskStatus.blocked
    task.last_activity_day = get_current_day(session)
    request = create_alternative_request(
        session,
        ticket=ticket,
        task=task,
        hire=hire,
        issue=data.issue.strip(),
        suggested_title=data.suggested_title.strip(),
        suggested_days=data.suggested_days,
        requested_by_id=user.id,
        source="department",
    )
    session.add(ticket)
    session.add(task)
    session.add(request)
    audit(
        session,
        hire.id,
        f"{ticket.team} submitted an alternative for {hire.name}: {request.suggested_title}; blocker: {request.issue}",
        "warning",
        f"user:{user.id}",
    )
    notify(session, "HR", f"{ticket.team} requested an alternative for {hire.name}: {request.suggested_title}.", hire.id, task.id)
    notify(session, ticket.team, f"Alternative request for {hire.name} was sent to HR for review.", hire.id, task.id)
    session.commit()
    return {
        "id": request.public_id,
        "status": request.status,
        "employee_name": hire.name,
        "employee_id": employee_display_id(hire.public_id),
        "suggested_title": request.suggested_title,
        "suggested_days": request.suggested_days,
    }


@router.get("/alternative-requests")
def list_alternative_requests(
    session: Session = Depends(get_session),
    _user=Depends(require_roles("ADMIN", "HR")),
):
    requests = session.exec(select(AlternativeRequest).order_by(AlternativeRequest.created_at.desc())).all()
    rows = []
    for request in requests:
        hire = session.get(Hire, request.hire_id)
        task = session.get(Task, request.task_id)
        requester = session.get(User, request.requested_by_id) if request.requested_by_id else None
        decision_maker = session.get(User, request.decision_by_id) if request.decision_by_id else None
        rows.append({
            "id": request.public_id,
            "ticket_id": (session.get(Ticket, request.ticket_id).ticket_id if session.get(Ticket, request.ticket_id) else ""),
            "hire_id": hire.public_id if hire else "",
            "employee_name": hire.name if hire else "Unknown employee",
            "employee_id": employee_display_id(hire.public_id) if hire else "Unknown ID",
            "task_title": request.original_title,
            "department": request.department,
            "issue": request.issue,
            "suggested_title": request.suggested_title,
            "suggested_days": request.suggested_days,
            "source": request.source,
            "status": request.status,
            "requested_by": requester.name if requester else "Progress monitor",
            "decision_by": decision_maker.name if decision_maker else None,
            "decision_note": request.decision_note,
            "created_at": request.created_at.isoformat(),
            "updated_at": request.updated_at.isoformat(),
        })
    return rows


@router.post("/alternative-requests/{request_id}/decision")
def decide_alternative_request(
    request_id: UUID,
    data: AlternativeDecisionRequest,
    session: Session = Depends(get_session),
    user=Depends(require_roles("HR")),
):
    request = session.exec(select(AlternativeRequest).where(AlternativeRequest.public_id == str(request_id))).first()
    if request is None:
        raise HTTPException(404, "Alternative request not found")
    if request.status != "pending":
        raise HTTPException(409, "This alternative request has already been decided")
    ticket = session.get(Ticket, request.ticket_id)
    task = session.get(Task, request.task_id)
    hire = session.get(Hire, request.hire_id)
    if ticket is None or task is None or hire is None:
        raise HTTPException(404, "The employee onboarding record for this request was not found")

    now = datetime.utcnow()
    decision_note = data.note.strip() or None
    request.decision_by_id = user.id
    request.decision_note = decision_note
    request.updated_at = now
    if data.decision == "approve":
        details = mcp_update_ticket_details(ticket.ticket_id, request.suggested_title, request.suggested_days)
        if details.get("error"):
            raise HTTPException(502, "The approved alternative could not be applied to the ticket")
        reopened = mcp_update_ticket_status(ticket.ticket_id, "open")
        if reopened.get("error"):
            raise HTTPException(503, "The approved alternative could not be reopened for the department")
        task.title = request.suggested_title
        task.duration_days = request.suggested_days
        task.fallback_title = None
        task.fallback_days = None
        task.status = TaskStatus.dispatched
        task.dispatched_day = get_current_day(session)
        task.last_activity_day = get_current_day(session)
        ticket.title = request.suggested_title
        ticket.estimate_days = request.suggested_days
        ticket.status = "open"
        request.status = "approved"
        message = f"HR approved the {ticket.team} alternative for {hire.name}: {request.suggested_title}."
        level = "info"
    else:
        paused = mcp_update_ticket_status(ticket.ticket_id, "blocked")
        if paused.get("error"):
            raise HTTPException(503, "The request could not be returned to the department")
        task.status = TaskStatus.blocked
        ticket.status = "blocked"
        request.status = "rejected"
        message = f"HR rejected the {ticket.team} alternative for {hire.name}: {request.suggested_title}."
        level = "warning"
    ticket.updated_at = now
    session.add(task)
    session.add(ticket)
    session.add(request)
    audit(session, hire.id, message + (f" Note: {decision_note}" if decision_note else ""), level, f"user:{user.id}")
    notify(session, ticket.team, message, hire.id, task.id)
    session.commit()
    if data.decision == "approve":
        monitor_tick(session)
    return {"id": request.public_id, "status": request.status, "ticket_id": ticket.ticket_id}


@router.post("/tickets/{ticket_id}/complete")
def complete_ticket(ticket_id: str, data: TicketCommentRequest, session: Session = Depends(get_session), user=Depends(require_roles("HR", "IT_STAFF"))):
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
    tickets = session.exec(select(Ticket).where(Ticket.status.in_(["pending_review", "done"]))
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
def review_department_work(task_id: UUID, data: HRReviewRequest, session: Session = Depends(get_session), user=Depends(require_roles("HR"))):
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
    suggestion = suggestion_for_task(task, hire, "HR requested an alternative after reviewing the department's completion evidence.")
    blocked = mcp_update_ticket_status(ticket.ticket_id, "blocked")
    if blocked.get("error"):
        raise HTTPException(503, "The ticket could not be paused while the alternative is prepared")
    ticket.status = "alternative_pending"
    ticket.updated_at = datetime.utcnow()
    task.status = TaskStatus.blocked
    task.last_activity_day = get_current_day(session)
    alternative = create_alternative_request(
        session,
        ticket=ticket,
        task=task,
        hire=hire,
        issue="HR requested an alternative after reviewing the department's completion evidence.",
        suggested_title=str(suggestion["title"]),
        suggested_days=int(suggestion["duration_days"]),
        requested_by_id=user.id,
        source="hr_review",
    )
    session.add(task)
    session.add(alternative)
    session.add(ticket)
    audit(session, task.hire_id, f"OnboardFlow suggested '{alternative.suggested_title}' as an alternative to '{task.title}' for {hire.name}; HR review is required", "warning", "agent:alternative_planner")
    notify(session, ticket.team, f"HR requested an alternative for {hire.name}; review the recommendation in your department queue.", task.hire_id, task.id)
    session.commit()
    return {"status": "alternative_pending", "suggested_title": alternative.suggested_title, "duration_days": alternative.suggested_days}


@router.post("/tickets/{ticket_id}/start")
def start_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("HR", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status == "done":
        raise HTTPException(409, "Completed tickets cannot be restarted")
    _sync_ticket_status(ticket, "in_progress", session, user)
    session.commit()
    return {"ticket_id": ticket_id, "status": "in_progress"}


@router.post("/tickets/{ticket_id}/block")
def block_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("HR", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    if ticket.status == "done":
        raise HTTPException(409, "Completed tickets cannot be blocked")
    _sync_ticket_status(ticket, "blocked", session, user)
    session.commit()
    return {"ticket_id": ticket_id, "status": "blocked"}


@router.get("/tickets/{ticket_id}/comments")
def list_ticket_comments(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("ADMIN", "HR", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    comments = session.exec(select(TicketComment).where(TicketComment.ticket_id == ticket.id).order_by(TicketComment.created_at)).all()
    return [
        {"id": item.public_id, "author": (session.get(User, item.author_id).name if session.get(User, item.author_id) else "Team member"),
         "body": item.body, "created_at": item.created_at.isoformat()}
        for item in comments
    ]


@router.post("/tickets/{ticket_id}/comments", status_code=201)
def add_ticket_comment(ticket_id: str, data: TicketCommentRequest, session: Session = Depends(get_session), user=Depends(require_roles("HR", "IT_STAFF"))):
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
def stall_ticket(ticket_id: str, session: Session = Depends(get_session), user=Depends(require_roles("HR", "IT_STAFF"))):
    ticket = _get_team_ticket(session, ticket_id, user)
    _sync_ticket_status(ticket, "stalled", session, user)
    # Do NOT update last_activity_day — that triggers stall detection
    session.commit()
    return {"ticket_id": ticket_id, "status": "stalled"}
