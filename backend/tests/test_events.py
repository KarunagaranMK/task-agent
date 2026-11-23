from sqlmodel import select

from app.auth import get_current_user
from app.domain.models import Notification, User


def _admin(session):
    user = User(email="events-admin@example.local", name="Events Admin", role="ADMIN", password_hash="unused")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_stream_ticket_is_short_lived_and_single_use(client, session):
    user = _admin(session)
    client.app.dependency_overrides[get_current_user] = lambda: user
    ticket_response = client.post("/events/ticket")
    assert ticket_response.status_code == 200
    ticket = ticket_response.json()["ticket"]
    session.add(Notification(for_role="Manager", message="An approval is waiting"))
    session.commit()

    response = client.get("/events/stream", params={"ticket": ticket, "max_events": 1})
    assert response.status_code == 200
    assert "event: connected" in response.text
    assert "event: notification" in response.text
    assert "An approval is waiting" in response.text

    replay = client.get("/events/stream", params={"ticket": ticket})
    assert replay.status_code == 401


def test_stream_ticket_requires_authenticated_creation(client):
    client.app.dependency_overrides.pop(get_current_user, None)
    assert client.post("/events/ticket").status_code == 401


def test_notifications_read_all_respects_role_filter(client, session):
    session.add_all([
        Notification(for_role="Manager", message="Manager event"),
        Notification(for_role="IT", message="IT event"),
    ])
    session.commit()
    response = client.post("/notifications/read-all")
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    assert all(item.read for item in session.exec(select(Notification)).all())
