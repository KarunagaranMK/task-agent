def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


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


def test_list_hires_empty(client):
    r = client.get("/hires")
    assert r.status_code == 200
    assert r.json() == []


def test_list_hires_after_create(client):
    client.post("/hires", json={"name": "A", "role": "default", "department": "X", "start_day": 5})
    r = client.get("/hires")
    assert r.status_code == 200
    assert len(r.json()) == 1


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


def test_hire_not_found(client):
    r = client.get("/hires/9999")
    assert r.status_code == 404


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
    assert len(hires) == 0


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
    assert audit[0]["actor"] == "plan_generator"
