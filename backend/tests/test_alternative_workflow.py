from datetime import date
from uuid import UUID

import pytest
from sqlmodel import select
from fastapi import HTTPException

from app.api import tasks as tasks_api
from app.auth import require_roles
from app.domain.models import AlternativeRequest, Hire, Task, TaskStatus, Ticket, User


def test_admin_is_read_only_for_hr_decisions():
    admin = User(email="admin@example.local", name="Admin", role="ADMIN", password_hash="unused")
    with pytest.raises(HTTPException) as exc:
        require_roles("HR")(user=admin)
    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    ("department", "fallback"),
    [
        ("IT", "Issue Loaner Laptop"),
        ("Facilities", "Assign a temporary shared workstation"),
        ("HR", "Use approved manual payroll enrollment"),
    ],
)
def test_departments_can_submit_alternatives_for_hr_decision(
    session, monkeypatch, department, fallback
):
    monkeypatch.setattr(tasks_api, "mcp_update_ticket_status", lambda *_args: {})
    monkeypatch.setattr(tasks_api, "mcp_update_ticket_details", lambda *_args: {})
    monkeypatch.setattr(tasks_api, "monitor_tick", lambda *_args: True)
    monkeypatch.setattr("app.config.settings.GEMINI_API_KEY", None)

    employee = Hire(
        name="Taylor Example", role="Data Analyst", department="Analytics",
        start_day=10, start_date=date(2027, 1, 12),
    )
    session.add(employee)
    session.commit()
    session.refresh(employee)
    user = User(
        email=f"{department.lower()}-team@example.local", name=f"{department} Teammate",
        role="HR" if department == "HR" else "IT_STAFF",
        team=None if department == "HR" else department,
        password_hash="not-used",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    task = Task(
        hire_id=employee.id, key=f"{department.lower()}:task", title=f"Prepare {department} task",
        team=department, duration_days=2, status=TaskStatus.dispatched,
        fallback_title=fallback, fallback_days=1,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    ticket = Ticket(
        ticket_id=f"TKT-{department.upper()}-1001", idempotency_key=f"alternative-{department}",
        title=task.title, team=department, estimate_days=2, status="open",
        hire_id=employee.id, task_id=task.id,
    )
    task.ticket_id = ticket.ticket_id
    session.add(ticket)
    session.add(task)
    session.commit()
    session.refresh(ticket)

    suggestion = tasks_api.suggest_ticket_alternative(
        ticket.ticket_id,
        tasks_api.AlternativeSuggestionRequest(issue="The assigned resource is unavailable before the start date."),
        session,
        user,
    )
    assert suggestion["suggested_title"] == fallback
    submitted = tasks_api.submit_ticket_alternative(
        ticket.ticket_id,
        tasks_api.AlternativeSubmissionRequest(
            issue=suggestion["issue"], suggested_title=suggestion["suggested_title"],
            suggested_days=suggestion["suggested_days"],
        ),
        session,
        user,
    )
    assert submitted["status"] == "pending"
    assert submitted["employee_name"] == employee.name
    assert submitted["employee_id"].startswith("EMP-")
    assert session.get(Task, task.id).status == TaskStatus.blocked

    hr_user = User(email="hr-reviewer@example.local", name="HR Reviewer", role="HR", password_hash="not-used")
    admin = User(email="admin-monitor@example.local", name="Admin Monitor", role="ADMIN", password_hash="not-used")
    session.add(hr_user)
    session.add(admin)
    session.commit()
    session.refresh(hr_user)
    session.refresh(admin)
    history = tasks_api.list_alternative_requests(session, admin)
    request_view = next(item for item in history if item["id"] == submitted["id"])
    assert request_view["status"] == "pending"
    assert request_view["department"] == department
    assert request_view["employee_id"] == submitted["employee_id"]

    decision = "reject" if department == "IT" else "approve"
    result = tasks_api.decide_alternative_request(
        UUID(submitted["id"]),
        tasks_api.AlternativeDecisionRequest(decision=decision, note="Reviewed by HR."),
        session,
        hr_user,
    )
    assert result["status"] == ("rejected" if decision == "reject" else "approved")
    updated_task = session.get(Task, task.id)
    updated_ticket = session.get(Ticket, ticket.id)
    assert updated_task.status == (TaskStatus.blocked if decision == "reject" else TaskStatus.dispatched)
    assert updated_ticket.status == ("blocked" if decision == "reject" else "open")
    saved = session.exec(select(AlternativeRequest).where(AlternativeRequest.public_id == submitted["id"])).first()
    assert saved is not None
    assert saved.decision_by_id == hr_user.id
