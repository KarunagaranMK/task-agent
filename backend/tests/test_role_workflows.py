from uuid import UUID

from sqlmodel import select

from app.auth import get_current_user
from app.domain.models import Hire, SimState, Task, Ticket, User


def test_removed_new_hire_portal_routes_are_not_exposed(client):
    assert client.get("/me/onboarding").status_code == 404
    assert client.post("/me/issues", json={"message": "I need help."}).status_code == 404


def test_account_profile_and_notification_preferences_are_user_scoped(client, session):
    user = User(email="profile@example.local", name="Profile User", role="IT_STAFF", password_hash="unused")
    session.add(user)
    session.commit()
    session.refresh(user)
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: user

    assert client.get("/auth/preferences").json() == {"in_app": True, "email": False}
    saved = client.put("/auth/preferences", json={"in_app": False, "email": True})
    assert saved.status_code == 200
    assert client.get("/auth/preferences").json() == {"in_app": False, "email": True}
    assert client.get("/notifications").json() == []
    changed = client.put("/auth/profile", json={"name": "Updated Name"})
    assert changed.status_code == 200
    assert changed.json()["name"] == "Updated Name"


def test_ticket_console_start_block_and_comments(client):
    client.post("/hires", json={"name": "Queue Test", "role": "Data Analyst", "department": "Analytics", "start_day": 8})
    client.post("/monitor/tick")
    tickets = client.get("/tickets").json()
    assert tickets
    assert str(UUID(tickets[0]["id"])) == tickets[0]["id"]
    ticket_id = tickets[0]["ticket_id"]

    started = client.post(f"/tickets/{ticket_id}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "in_progress"
    comment = client.post(f"/tickets/{ticket_id}/comments", json={"body": "Laptop imaging has started."})
    assert comment.status_code == 201
    assert str(UUID(comment.json()["id"])) == comment.json()["id"]
    comments = client.get(f"/tickets/{ticket_id}/comments").json()
    assert comments[0]["id"] == comment.json()["id"]
    assert comments[0]["body"] == "Laptop imaging has started."
    blocked = client.post(f"/tickets/{ticket_id}/block")
    assert blocked.status_code == 200
    assert blocked.json()["status"] == "blocked"


def test_stalled_ticket_waits_for_hr_alternative_decision(client, session):
    hire = client.post("/hires", json={"name": "Stall Recovery", "role": "Data Analyst", "department": "Analytics", "start_day": 8}).json()
    client.post("/monitor/tick")
    from app.domain.models import Hire
    internal_hire = session.exec(select(Hire).where(Hire.public_id == hire["id"])).one()
    laptop = session.exec(select(Task).where(Task.hire_id == internal_hire.id, Task.key == "it:laptop")).one()
    assert laptop.ticket_id
    ticket = session.exec(select(Ticket).where(Ticket.ticket_id == laptop.ticket_id)).one()
    state = session.exec(select(SimState)).first()
    assert state is not None
    state.current_day = 2
    session.add_all([laptop, state])
    session.commit()

    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=3, email="it@example.local", name="IT Teammate", role="IT_STAFF", team="IT", password_hash="unused"
    )
    assert client.post(f"/tickets/{ticket.ticket_id}/stall").status_code == 200
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="hr@example.local", name="Test HR", role="HR", password_hash="unused"
    )
    task = next(task for task in client.get(f"/hires/{hire['id']}/tasks").json() if task["key"] == "it:laptop")
    assert task["status"] == "dispatched"

    client.post("/monitor/tick")
    recovered = next(task for task in client.get(f"/hires/{hire['id']}/tasks").json() if task["key"] == "it:laptop")
    assert recovered["title"] == laptop.title
    assert recovered["status"] == "blocked"
    assert recovered["flag"] == "escalated"
    recovered_ticket = session.exec(select(Ticket).where(Ticket.ticket_id == recovered["ticket_id"])).one()
    assert recovered_ticket.status == "alternative_pending"
    alternative = client.get("/alternative-requests").json()
    assert any(item["employee_name"] == "Stall Recovery" and item["status"] == "pending" for item in alternative)


def test_manager_cannot_make_hr_review_decisions(client):
    hire = client.post("/hires", json={"name": "Approval Test", "role": "Data Analyst", "department": "Analytics", "start_day": 8}).json()
    assert hire["id"]
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=2, email="manager@example.local", name="Manager", role="MANAGER", password_hash="unused"
    )
    response = client.post(
        "/tasks/00000000-0000-4000-8000-000000000000/review",
        json={"decision": "accept"},
    )
    assert response.status_code == 403
