from datetime import date

from app.auth import get_current_user
from app.domain.models import Hire, Task, TaskStatus, Ticket, User
from app.api import tasks as tasks_api
from app.mcp_clients.tools import create_ticket as mcp_create_ticket


def _submitted_work(session):
    hire = Hire(name="Review Example", role="Data Analyst", department="Analytics", start_day=8, start_date=date(2027, 1, 12))
    session.add(hire)
    session.commit()
    session.refresh(hire)
    task = Task(hire_id=hire.id, key="it:account", title="Create analytics account", team="IT", duration_days=1, status=TaskStatus.dispatched)
    external = mcp_create_ticket("hr-review-test", task.title, "IT", 1)
    task.ticket_id = external["ticket_id"]
    session.add(task)
    session.commit()
    session.refresh(task)
    session.add(Ticket(ticket_id=external["ticket_id"], idempotency_key="hr-review-test", title=task.title, team="IT", estimate_days=1, status="open", hire_id=hire.id, task_id=task.id))
    session.commit()
    return hire, task, external["ticket_id"]


def _act_as(client, *, role, team=None):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=2, email=f"{role.lower()}-review@example.local", name=f"{role} Reviewer",
        role=role, team=team, password_hash="unused",
    )


def test_department_completion_waits_for_hr_acceptance(client, session, monkeypatch):
    monkeypatch.setattr(tasks_api, "monitor_tick", lambda _session: True)
    hire, task, ticket_id = _submitted_work(session)

    _act_as(client, role="IT_STAFF", team="IT")
    completed = client.post(f"/tickets/{ticket_id}/complete", json={"body": "Laptop is configured and verified against the employee's role."})
    assert completed.status_code == 200
    assert completed.json()["status"] == "pending_review"
    _act_as(client, role="HR")
    reviews = client.get("/tasks/hr-review")
    assert reviews.status_code == 200
    assert reviews.json()[0]["hire_name"] == hire.name
    assert reviews.json()[0]["verification_notes"][0]["body"] == "Laptop is configured and verified against the employee's role."
    assert session.get(Task, task.id).status == TaskStatus.dispatched

    accepted = client.post(f"/tasks/{task.public_id}/review", json={"decision": "accept"})
    assert accepted.status_code == 200, accepted.text
    assert session.get(Task, task.id).status == TaskStatus.done
    accepted_history = client.get("/tasks/hr-review").json()
    assert len(accepted_history) == 1
    assert accepted_history[0]["status"] == "done"


def test_hr_can_request_and_approve_agent_alternative(client, session, monkeypatch):
    monkeypatch.setattr(tasks_api, "monitor_tick", lambda _session: True)
    _, task, ticket_id = _submitted_work(session)
    monkeypatch.setattr(tasks_api, "suggestion_for_task", lambda *_args: {
        "title": "Provision a temporary analytics account", "duration_days": 2,
    })

    _act_as(client, role="IT_STAFF", team="IT")
    assert client.post(f"/tickets/{ticket_id}/complete", json={"body": "Access verified with the department owner."}).status_code == 200
    _act_as(client, role="HR")
    proposed = client.post(f"/tasks/{task.public_id}/review", json={"decision": "alternative"})
    assert proposed.status_code == 200, proposed.text
    assert proposed.json()["suggested_title"] == "Provision a temporary analytics account"
    alternative = next(
        item for item in client.get("/alternative-requests").json()
        if item["task_title"] == task.title and item["status"] == "pending"
    )

    accepted = client.post(
        f"/alternative-requests/{alternative['id']}/decision",
        json={"decision": "approve", "note": "Approved by HR."},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "approved"
    assert session.get(Task, task.id).title == "Provision a temporary analytics account"
    assert session.get(Task, task.id).status == TaskStatus.dispatched
    assert client.get("/tasks/hr-review").json() == []
