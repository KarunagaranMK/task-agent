"""Shared persistence for department and monitor-generated alternatives."""
from datetime import datetime

from sqlmodel import Session, select

from app.domain.models import AlternativeRequest, Hire, Task, Ticket
from app.services.llm import draft_alternative_title


def employee_display_id(public_id: str) -> str:
    return f"EMP-{public_id.replace('-', '')[:8].upper()}"


def pending_alternative(session: Session, ticket_id: int) -> AlternativeRequest | None:
    return session.exec(
        select(AlternativeRequest)
        .where(AlternativeRequest.ticket_id == ticket_id, AlternativeRequest.status == "pending")
        .order_by(AlternativeRequest.created_at.desc())
    ).first()


def create_alternative_request(
    session: Session,
    *,
    ticket: Ticket,
    task: Task,
    hire: Hire,
    issue: str,
    suggested_title: str,
    suggested_days: int,
    requested_by_id: int | None,
    source: str,
) -> AlternativeRequest:
    request = AlternativeRequest(
        ticket_id=ticket.id,
        task_id=task.id,
        hire_id=hire.id,
        department=str(ticket.team),
        original_title=task.title,
        issue=issue[:1000],
        suggested_title=suggested_title[:160],
        suggested_days=max(1, min(suggested_days, 30)),
        requested_by_id=requested_by_id,
        source=source,
        status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(request)
    return request


def suggestion_for_task(task: Task, hire: Hire, issue: str) -> dict[str, int | str]:
    team = getattr(task.team, "value", task.team)
    return draft_alternative_title(
        task.title,
        hire.role,
        str(team),
        task.fallback_title,
        task.fallback_days,
        blocker_reason=issue,
    )
