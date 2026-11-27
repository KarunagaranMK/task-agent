from sqlmodel import select

from app.domain.models import AgentExecution, Hire, OutboxItem, SimState, Task


def test_plan_preview_runs_through_supervisor_and_persists_agent_history(client, session):
    preview = client.post("/hires/plan-preview", json={"role": "Software Engineer"})
    assert preview.status_code == 200
    assert preview.json()["tasks"]

    agents = client.get("/agents")
    assert agents.status_code == 200
    plan_agent = next(item for item in agents.json() if item["name"] == "plan_generator")
    assert plan_agent["execution_count"] == 1
    assert plan_agent["status"] == "idle"
    plan_executions = session.exec(select(AgentExecution).where(AgentExecution.operation == "plan")).all()
    assert plan_executions
    assert all(item.hire_id is None for item in plan_executions)

    activity = client.get("/agents/activity")
    assert activity.status_code == 200
    assert any(item["agent"] == "supervisor" and item["operation"] == "plan" for item in activity.json()["items"])


def test_monitor_supervisor_invokes_team_and_hris_workers(client):
    response = client.post("/agents/monitor/run")
    assert response.status_code == 200
    assert response.json()["completed"] is True
    assert response.json()["thread_id"].startswith("monitor-")

    activity = client.get("/agents/activity", params={"page_size": 50})
    assert activity.status_code == 200
    names = {item["agent"] for item in activity.json()["items"]}
    assert {"supervisor", "progress_monitor", "it_provisioner", "facilities_coordinator", "hris_coordinator"} <= names


def test_new_hire_plan_does_not_create_manager_approval_stage(client):
    hire = client.post("/hires", json={
        "name": "Jordan Lee", "role": "Data Analyst", "department": "Analytics", "start_day": 8,
    })
    assert hire.status_code == 200
    tasks = client.get(f"/hires/{hire.json()['id']}/tasks").json()
    assert tasks
    assert all(task["status"] != "awaiting_approval" for task in tasks)


def test_integration_health_uses_mcp_and_reports_scheduler_state(client):
    response = client.get("/integrations/status")
    assert response.status_code == 200
    data = response.json()
    assert {item["name"] for item in data["integrations"]} == {"ITSM MCP", "HRIS MCP", "Gemini API"}
    assert all(item["mock"] for item in data["integrations"][:2])
    assert data["scheduler"]["enabled"] is False
    assert data["outbox"]["pending"] == 0
def test_integration_outbox_lists_and_retries_selected_item(client, session):
    hire_response = client.post("/hires", json={
        "name": "Outbox Test", "role": "Data Analyst", "department": "Analytics", "start_day": 8,
    })
    hire_id = hire_response.json()["id"]
    hire = session.exec(select(Hire).where(Hire.public_id == hire_id)).first()
    task = session.exec(select(Task).where(Task.hire_id == hire.id)).first()
    item = OutboxItem(hire_id=hire.id, task_id=task.id, idempotency_key=f"hire{hire.id}:manual-retry",
                      title="Provision laptop retry", team="IT", estimate_days=2)
    session.add(item)
    session.flush()

    listing = client.get("/integrations/outbox")
    assert listing.status_code == 200
    queued = next(row for row in listing.json() if row["id"] == item.id)
    assert queued["hire"] == "Outbox Test"
    assert queued["retry_count"] == 0

    response = client.post(f"/integrations/outbox/{item.id}/retry")
    assert response.status_code == 200
    assert response.json()["status"] == "dispatched"
    assert session.exec(select(OutboxItem).where(OutboxItem.id == item.id)).first() is None


def test_integration_outbox_retry_rejects_known_service_outage(client, session):
    item = OutboxItem(hire_id=1, task_id=1, idempotency_key="hire1:offline-retry",
                      title="Queued request", team="IT", estimate_days=1)
    session.add(SimState(current_day=0, itsm_offline=True))
    session.add(item)
    session.flush()
    response = client.post(f"/integrations/outbox/{item.id}/retry")
    assert response.status_code == 409
    assert response.json()["detail"].startswith("ITSM is marked offline")


def test_employee_archive_hides_record_but_preserves_workflow_history(client):
    response = client.post("/hires", json={
        "name": "Archive Candidate", "role": "Data Analyst", "department": "Analytics", "start_day": 8,
    })
    hire_id = response.json()["id"]
    archived = client.post(f"/hires/{hire_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"
    assert all(hire["id"] != hire_id for hire in client.get("/hires").json())
    assert any(hire["id"] == hire_id for hire in client.get("/hires", params={"include_archived": True}).json())
    assert client.get(f"/hires/{hire_id}/tasks").status_code == 200
