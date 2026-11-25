from sqlmodel import select


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Request-ID"]


def test_versioned_api_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_checks_database_and_supports_api_aliases(client):
    for path in ("/ready", "/api/ready", "/api/v1/ready"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.json() == {"status": "ready", "checks": {"database": "ok"}}


def test_create_hire(client):
    r = client.post(
        "/hires",
        json={"name": "Priya", "role": "Data Analyst", "department": "Analytics", "start_day": 8},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Priya"
    assert data["id"] is not None
    assert data["readiness"] == 0.0
    assert data["start_date"]


def test_create_hire_uses_organization_business_calendar(client, session, monkeypatch):
    from datetime import date
    from app.domain.models import AppSetting
    from app.services.clock import Clock

    monkeypatch.setattr(Clock, "local_today", lambda _self: date(2026, 11, 24))
    session.add(AppSetting(key="holidays", value='["2026-11-26"]'))
    session.commit()
    metrics = client.get("/metrics").json()
    assert metrics["current_date"] == "2026-11-24"
    assert metrics["earliest_joining_date"] == "2026-11-25"
    assert metrics["default_joining_date"] == "2026-12-07"
    created = client.post("/api/v1/hires", json={
        "name": "Calendar QA", "role": "default", "department": "Ops", "start_date": "2026-11-27",
    })
    assert created.status_code == 200
    assert created.json()["start_date"] == "2026-11-27"
    assert created.json()["start_day"] == 2

    weekend = client.post("/hires", json={
        "name": "Weekend QA", "role": "default", "department": "Ops", "start_date": "2026-11-28",
    })
    assert weekend.status_code == 422
    past = client.post("/hires", json={
        "name": "Past QA", "role": "default", "department": "Ops", "start_date": "2026-11-23",
    })
    assert past.status_code == 422


def test_hr_can_edit_hire_details_and_recalculate_joining_date(client, session, monkeypatch):
    from datetime import date
    from app.domain.models import AuditEvent, User
    from app.services.clock import Clock

    monkeypatch.setattr(Clock, "local_today", lambda _self: date(2026, 11, 24))
    manager = User(email="manager-edit@example.local", name="Edit Manager", role="MANAGER", password_hash="unused")
    session.add(manager)
    session.commit()
    session.refresh(manager)
    hire = client.post("/hires", json={"name": "Edit Me", "role": "Analyst", "department": "Data", "start_day": 8}).json()

    updated = client.patch(f"/api/v1/hires/{hire['id']}", json={
        "name": "Edited Name", "role": "Software Engineer", "department": "Analytics", "manager_id": manager.id, "start_date": "2026-12-07",
    })
    assert updated.status_code == 200
    assert updated.json()["name"] == "Edited Name"
    assert updated.json()["role"] == "Software Engineer"
    assert updated.json()["department"] == "Analytics"
    assert updated.json()["manager_id"] == manager.id
    assert updated.json()["start_date"] == "2026-12-07"
    assert updated.json()["start_day"] == 9
    assert session.exec(select(AuditEvent).where(AuditEvent.hire_id == hire["id"], AuditEvent.actor_agent == "user:1")).first()
    tasks = client.get(f"/hires/{hire['id']}/tasks").json()
    assert len(tasks) == 9
    assert {task["key"] for task in tasks} >= {"it:repo_access", "it:laptop"}

    from app.domain.models import Task, TaskStatus
    first_task = session.exec(select(Task).where(Task.hire_id == hire["id"])).first()
    first_task.status = TaskStatus.dispatched
    session.add(first_task)
    session.commit()
    locked_role = client.patch(f"/hires/{hire['id']}", json={"role": "Data Analyst"})
    assert locked_role.status_code == 409

    weekend = client.patch(f"/hires/{hire['id']}", json={"start_date": "2026-11-28"})
    assert weekend.status_code == 422
    whitespace_name = client.patch(f"/hires/{hire['id']}", json={"name": "  "})
    assert whitespace_name.status_code == 422
    unexpected_field = client.patch(f"/hires/{hire['id']}", json={"unexpected": "value"})
    assert unexpected_field.status_code == 422


def test_plan_preview_returns_validated_role_template(client):
    response = client.post("/hires/plan-preview", json={"role": "Data Analyst"})
    assert response.status_code == 200
    tasks = response.json()["tasks"]
    assert any(task["key"] == "it:laptop" for task in tasks)
    assert any(task["needs_approval"] for task in tasks)


def test_what_if_returns_recomputed_path(client):
    hire = client.post("/hires", json={"name": "Priya", "role": "Data Analyst", "department": "Analytics", "start_day": 8}).json()
    response = client.post(f"/hires/{hire['id']}/what-if", json={"task_key": "it:laptop", "delay_days": 2})
    assert response.status_code == 200
    assert response.json()["delta_days"] >= 0
    assert response.json()["critical_path"]


def test_risk_explanation_uses_template_without_llm_key(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)
    hire = client.post("/hires", json={"name": "Template User", "role": "default", "department": "Ops", "start_day": 8}).json()
    response = client.get(f"/hires/{hire['id']}/explain")
    assert response.status_code == 200
    assert response.json()["source"] == "template"


def test_list_hires_empty(client):
    r = client.get("/hires")
    assert r.status_code == 200
    assert r.json() == []


def test_list_hires_after_create(client):
    client.post("/hires", json={"name": "A", "role": "default", "department": "X", "start_day": 5})
    r = client.get("/hires")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_hire_list_server_search_sort_filter_and_pagination(client):
    for name in ["Charlie", "Alpha", "Bravo"]:
        response = client.post("/hires", json={"name": name, "role": "default", "department": "Analytics", "start_day": 5})
        assert response.status_code == 200

    first = client.get("/hires", params={"page": 1, "page_size": 2, "sort_by": "name", "sort_order": "asc"})
    assert first.status_code == 200
    assert [hire["name"] for hire in first.json()] == ["Alpha", "Bravo"]
    assert first.headers["x-total-count"] == "3"
    assert first.headers["x-total-pages"] == "2"
    assert first.headers["x-page"] == "1"

    second = client.get("/hires", params={"page": 2, "page_size": 2, "sort_by": "name", "sort_order": "asc"})
    assert [hire["name"] for hire in second.json()] == ["Charlie"]
    assert second.headers["x-page"] == "2"

    filtered = client.get("/hires", params={"search": "brav", "status": "on_track"})
    assert [hire["name"] for hire in filtered.json()] == ["Bravo"]
    assert filtered.headers["x-total-count"] == "1"
    assert client.get("/hires", params={"page_size": 101}).status_code == 422


def test_get_hire_tasks(client):
    r = client.post(
        "/hires",
        json={"name": "C", "role": "Data Analyst", "department": "X", "start_day": 10},
    )
    hid = r.json()["id"]
    r2 = client.get(f"/hires/{hid}/tasks")
    assert r2.status_code == 200
    tasks = r2.json()
    assert len(tasks) >= 8  # Data Analyst has 10 tasks


def test_hire_tasks_include_live_schedule_positions(client):
    hire = client.post(
        "/hires",
        json={"name": "Schedule QA", "role": "Data Analyst", "department": "Analytics", "start_day": 8},
    ).json()
    response = client.get(f"/hires/{hire['id']}/tasks")
    assert response.status_code == 200
    tasks = {task["key"]: task for task in response.json()}
    laptop = tasks["it:laptop"]
    assert laptop["current_day"] == 0
    assert laptop["remaining_days"] == 5
    assert laptop["schedule_start_day"] == 0
    assert laptop["schedule_finish_day"] == 5
    assert tasks["it:accounts"]["schedule_start_day"] == 0
    assert tasks["it:vpn"]["schedule_start_day"] == 1


def test_hire_lifecycle_pause_resume_cancel(client):
    hire = client.post(
        "/hires",
        json={"name": "Lifecycle QA", "role": "default", "department": "Ops", "start_day": 8},
    ).json()
    hire_id = hire["id"]
    assert client.post("/monitor/tick").status_code == 200
    active_before_pause = client.get(f"/hires/{hire_id}/tasks").json()
    ticket_ids = [task["ticket_id"] for task in active_before_pause if task["ticket_id"]]
    assert ticket_ids

    paused = client.post(f"/hires/{hire_id}/pause")
    assert paused.status_code == 200
    assert client.get(f"/hires/{hire_id}").json()["status"] == "paused"
    paused_tasks = client.get(f"/hires/{hire_id}/tasks").json()
    assert {task["status"] for task in paused_tasks} == {"paused"}
    assert all(task["status"] == "cancelled" for task in client.get("/tickets").json() if task["ticket_id"] in ticket_ids)

    assert client.post("/monitor/tick").status_code == 200
    assert {task["status"] for task in client.get(f"/hires/{hire_id}/tasks").json()} == {"paused"}

    resumed = client.post(f"/hires/{hire_id}/resume")
    assert resumed.status_code == 200
    assert client.get(f"/hires/{hire_id}").json()["status"] == "on_track"
    assert {task["status"] for task in client.get(f"/hires/{hire_id}/tasks").json()} <= {"pending", "awaiting_approval", "dispatched"}

    cancelled = client.post(f"/hires/{hire_id}/cancel")
    assert cancelled.status_code == 200
    assert client.get(f"/hires/{hire_id}").json()["status"] == "cancelled"
    assert {task["status"] for task in client.get(f"/hires/{hire_id}/tasks").json()} == {"cancelled"}
    assert client.post(f"/hires/{hire_id}/resume").status_code == 409


def test_only_hr_and_admin_can_change_hire_lifecycle(client):
    from app.auth import get_current_user
    from app.domain.models import User
    from app.main import app

    hire = client.post(
        "/hires",
        json={"name": "Role Guard QA", "role": "default", "department": "Ops", "start_day": 8},
    ).json()
    app.dependency_overrides[get_current_user] = lambda: User(
        id=2, email="manager@example.local", name="Manager", role="MANAGER", password_hash="unused"
    )
    for action in ("pause", "resume", "cancel"):
        response = client.post(f"/hires/{hire['id']}/{action}")
        assert response.status_code == 403


def test_hire_not_found(client):
    r = client.get("/hires/9999")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["code"] == "http_404"
    assert r.json()["request_id"]


def test_validation_errors_use_problem_details(client):
    response = client.post("/hires", json={"name": "", "role": "", "department": ""})
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "validation_error"
    assert response.json()["field_errors"]


def test_sim_advance(client):
    r = client.post("/sim/advance")
    assert r.status_code == 200
    assert r.json()["current_day"] == 1


def test_sim_advance_twice(client):
    client.post("/sim/advance")
    r = client.post("/sim/advance")
    assert r.json()["current_day"] == 2


def test_monitor_tick(client):
    r = client.post("/monitor/tick")
    assert r.status_code == 200


def test_metrics_empty(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    data = r.json()
    assert "total_hires" in data
    assert data["total_hires"] == 0


def test_metrics_with_hires(client):
    client.post("/hires", json={"name": "X", "role": "default", "department": "X", "start_day": 5})
    r = client.get("/metrics")
    assert r.json()["total_hires"] == 1


def test_chaos_itsm(client):
    r = client.post("/chaos/itsm?offline=true")
    assert r.status_code == 200
    assert r.json()["itsm_offline"] is True
    r2 = client.post("/chaos/itsm?offline=false")
    assert r2.json()["itsm_offline"] is False


def test_experiment_deterministic(client):
    r1 = client.post("/experiments/run", json={"n_hires": 100, "stall_probability": 0.2, "seed": 42})
    r2 = client.post("/experiments/run", json={"n_hires": 100, "stall_probability": 0.2, "seed": 42})
    assert r1.json() == r2.json()


def test_experiment_orchestrator_wins(client):
    r = client.post("/experiments/run", json={"n_hires": 200, "stall_probability": 0.2, "seed": 42})
    data = r.json()
    assert data["orchestrator_readiness_pct"] > data["static_checklist_readiness_pct"]


def test_reset(client):
    client.post("/hires", json={"name": "X", "role": "default", "department": "X", "start_day": 5})
    r = client.post("/reset")
    assert r.status_code == 200
    hires = client.get("/hires").json()
    assert len(hires) == 3
    priya = next(hire for hire in hires if hire["name"] == "Priya Sharma")
    assert priya["start_day"] == 8


def test_approve_task(client):
    r = client.post(
        "/hires",
        json={"name": "P", "role": "Data Analyst", "department": "Analytics", "start_day": 10},
    )
    hid = r.json()["id"]
    client.post("/monitor/tick")
    tasks = client.get(f"/hires/{hid}/tasks").json()
    approval_tasks = [t for t in tasks if t["needs_approval"]]
    if approval_tasks:
        t = approval_tasks[0]
        r2 = client.post(f"/tasks/{t['id']}/approve")
        assert r2.status_code == 200
        assert r2.json()["status"] == "approved"


def test_notifications(client):
    r = client.get("/notifications")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_notifications_role_filter(client):
    r = client.get("/notifications?role=Manager")
    assert r.status_code == 200


def test_audit_trail(client):
    r = client.post(
        "/hires",
        json={"name": "Audit Test", "role": "default", "department": "X", "start_day": 5},
    )
    hid = r.json()["id"]
    audit = client.get(f"/hires/{hid}/audit").json()
    assert len(audit) >= 1  # at least the plan_generator event
    assert audit[0]["actor"] == "agent:plan_generator"
