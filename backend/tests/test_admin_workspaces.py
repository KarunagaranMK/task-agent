import json

from app.auth import get_current_user
from app.domain.models import AppSetting, ExperimentRun, OnboardingTemplate, SecurityAudit, User
from app.services.planner import ROLE_TEMPLATES
from sqlmodel import select


def test_templates_validate_version_and_audit_publish(client, session):
    response = client.get("/templates")
    assert response.status_code == 200
    assert "Data Analyst" in {item["role_key"] for item in response.json()}

    task = ROLE_TEMPLATES["default"][0]
    created = client.post("/templates", json={"role_key": "Default", "tasks": [task]})
    assert created.status_code == 201
    assert created.json()["version"] == 1
    created2 = client.post("/templates", json={"role_key": "Default", "tasks": [task]})
    assert created2.json()["version"] == 2
    assert len(session.exec(select(OnboardingTemplate)).all()) == 2
    assert len(session.exec(select(SecurityAudit).where(SecurityAudit.action == "template_published")).all()) == 2


def test_invalid_template_dag_is_rejected(client):
    response = client.post("/templates", json={"role_key": "Bad", "tasks": [
        {"key": "a", "title": "A", "team": "IT", "duration_days": 1, "depends_on": ["missing"]},
    ]})
    assert response.status_code == 422


def test_published_role_template_is_used_for_future_hires(client, session):
    custom = [{"key": "custom:welcome", "title": "Personal welcome", "team": "HR",
               "duration_days": 2, "depends_on": [], "needs_approval": False}]
    assert client.post("/templates", json={"role_key": "Product Specialist", "tasks": custom}).status_code == 201
    created = client.post("/hires", json={"name": "Rae Example", "role": "Product Specialist",
                                          "department": "Customer Success", "start_day": 8})
    assert created.status_code == 200
    tasks = client.get(f"/hires/{created.json()['id']}/tasks").json()
    assert [task["key"] for task in tasks] == ["custom:welcome"]


def test_settings_are_admin_only_and_persisted(client, session, monkeypatch):
    response = client.put("/settings", json={"stall_after_days": 3, "near_critical_margin": 2,
        "monitor_interval_minutes": 10, "auto_worker_enabled": True, "timezone": "UTC", "holidays": ["2026-12-25"]})
    assert response.status_code == 200
    assert client.get("/settings").json()["timezone"] == "UTC"
    assert json.loads(client.get("/settings").json()["holidays"]) == ["2026-12-25"]
    assert session.get(AppSetting, "auto_worker_enabled").value == "true"
    invalid_zone = client.put("/settings", json={"stall_after_days": 3, "near_critical_margin": 2,
        "monitor_interval_minutes": 10, "auto_worker_enabled": True, "timezone": "Not/AZone", "holidays": []})
    assert invalid_zone.status_code == 422

    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=8, email="hr@example.local", name="HR", role="HR", password_hash="unused")
    forbidden = client.put("/settings", json={"stall_after_days": 3, "near_critical_margin": 2,
        "monitor_interval_minutes": 10, "auto_worker_enabled": False, "timezone": "UTC", "holidays": []})
    assert forbidden.status_code == 403


def test_experiment_is_deterministic_and_saved_to_history(client, session):
    params = {"n_hires": 50, "stall_probability": 0.3, "seed": 42}
    first = client.post("/experiments/run", json=params)
    second = client.post("/experiments/run", json=params)
    assert first.status_code == 200 and first.json() == second.json()
    experiments = session.exec(select(ExperimentRun)).all()
    assert len(experiments) == 2
    assert json.loads(experiments[0].parameters_json) == params
    assert len(client.get("/experiments").json()) == 2


def test_audit_filter_returns_security_actions(client, session):
    session.add(SecurityAudit(actor_id=1, action="settings_updated", target="workspace", detail="monitor settings"))
    session.commit()
    rows = client.get("/audit?search=monitor").json()
    assert any(row["kind"] == "settings_updated" for row in rows)
