from datetime import date
from uuid import UUID

from sqlmodel import select

from app.auth import get_current_user
from app.domain.models import Hire, Notification, SimState, Task, User


def test_new_hire_gets_only_self_service_summary(client, session):
    new_hire = User(email="priya@example.local", name="Priya Sharma", role="NEW_HIRE", password_hash="unused")
    session.add(new_hire)
    session.commit()
    session.refresh(new_hire)
    hire = Hire(name="Priya Sharma", role="Data Analyst", department="Analytics", start_day=8,
                start_date=date(2026, 12, 4), new_hire_user_id=new_hire.id)
    session.add(hire)
    session.commit()
    session.refresh(hire)
    session.add(Task(hire_id=hire.id, key="it:laptop", title="Prepare your laptop", team="IT", duration_days=2))
    session.commit()
    app_user = new_hire
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: app_user

    response = client.get("/me/onboarding")

    assert response.status_code == 200
    data = response.json()
    assert data["hire"]["name"] == "Priya Sharma"
    assert data["hire"]["start_date"] == "2026-12-04"
    assert data["tasks"] == [{"title": "Prepare your laptop", "status": "pending", "eta_day": 2}]
    assert "audit" not in data and "ticket_id" not in data["tasks"][0]


def test_new_hire_can_report_issue_to_hr(client, session):
    new_hire = User(email="priya@example.local", name="Priya Sharma", role="NEW_HIRE", password_hash="unused")
    session.add(new_hire)
    session.commit()
    session.refresh(new_hire)
    hire = Hire(name="Priya Sharma", role="Data Analyst", department="Analytics", start_day=8, new_hire_user_id=new_hire.id)
    session.add(hire)
    session.commit()
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: new_hire

    response = client.post("/me/issues", json={"message": "I need help with the first-day schedule."})

    assert response.status_code == 201
    item = session.exec(select(Notification)).one()
    assert item.for_role == "HR"
    assert item.hire_id == hire.id
    assert "first-day schedule" in item.message


def test_new_hire_portal_rejects_other_roles(client):
    response = client.get("/me/onboarding")
    assert response.status_code == 403


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


def test_stalled_ticket_remains_visible_to_monitor_fallback(client, session):
    hire = client.post("/hires", json={"name": "Stall Recovery", "role": "Data Analyst", "department": "Analytics", "start_day": 8}).json()
    client.post("/monitor/tick")
    ticket = next(ticket for ticket in client.get("/tickets").json() if ticket["title"] == "Provision Laptop (High RAM)")
    from app.domain.models import Hire
    internal_hire = session.exec(select(Hire).where(Hire.public_id == hire["id"])).one()
    laptop = session.exec(select(Task).where(Task.hire_id == internal_hire.id, Task.key == "it:laptop")).one()
    state = session.exec(select(SimState)).first()
    assert state is not None
    state.current_day = 2
    session.add_all([laptop, state])
    session.commit()

    assert client.post(f"/tickets/{ticket['ticket_id']}/stall").status_code == 200
    task = next(task for task in client.get(f"/hires/{hire['id']}/tasks").json() if task["key"] == "it:laptop")
    assert task["status"] == "dispatched"

    client.post("/monitor/tick")
    recovered = next(task for task in client.get(f"/hires/{hire['id']}/tasks").json() if task["key"] == "it:laptop")
    assert recovered["title"] == "Issue Loaner Laptop"
    assert recovered["flag"] == "rescheduled"
    recovered_ticket = next(ticket for ticket in client.get("/tickets").json() if ticket["ticket_id"] == recovered["ticket_id"])
    assert recovered_ticket["status"] == "open"


def test_manager_can_undo_recent_approval(client):
    hire = client.post("/hires", json={"name": "Approval Test", "role": "Data Analyst", "department": "Analytics", "start_day": 8}).json()
    client.post("/monitor/tick")
    tasks = client.get(f"/hires/{hire['id']}/tasks").json()
    approval = next(task for task in tasks if task["status"] == "awaiting_approval")
    assert client.post(f"/tasks/{approval['id']}/approve").status_code == 200
    undone = client.post(f"/tasks/{approval['id']}/undo-approval")
    assert undone.status_code == 200
    current = next(task for task in client.get(f"/hires/{hire['id']}/tasks").json() if task["id"] == approval["id"])
    assert current["status"] == "awaiting_approval"
