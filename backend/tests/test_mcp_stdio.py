from uuid import uuid4

from app.mcp_clients.stdio import clients


def test_itsm_stdio_session_round_trip_and_idempotency():
    assert clients.call("itsm", "reset_service", {}) == {"status": "reset"}
    key = f"test:{uuid4()}"
    created = clients.call("itsm", "create_ticket", {
        "idempotency_key": key,
        "title": "Provision laptop",
        "team": "IT",
        "estimate_days": 3,
    })
    repeated = clients.call("itsm", "create_ticket", {
        "idempotency_key": key,
        "title": "Provision laptop",
        "team": "IT",
        "estimate_days": 3,
    })
    assert created["ticket_id"] == repeated["ticket_id"]
    assert repeated["idempotent"] is True
    assert clients.call("itsm", "get_ticket_status", {"ticket_id": created["ticket_id"]})["status"] == "open"
    assert clients.call("itsm", "update_ticket_status", {"ticket_id": created["ticket_id"], "status": "done"})["status"] == "done"


def test_itsm_stdio_outage_returns_service_unavailable():
    clients.call("itsm", "reset_service", {})
    clients.call("itsm", "set_service_offline", {"offline": True})
    response = clients.call("itsm", "create_ticket", {
        "idempotency_key": f"offline:{uuid4()}", "title": "Unavailable", "team": "IT", "estimate_days": 1,
    })
    assert response == {"error": "service_unavailable"}
    clients.call("itsm", "set_service_offline", {"offline": False})
