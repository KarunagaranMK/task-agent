"""Agent execution history and integration readiness APIs."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.auth import require_roles
from app.config import settings
from app.db.database import get_session
from app.domain.models import AgentExecution, Hire, OutboxItem, SimState, Task
from app.mcp_clients.tools import get_new_hire, get_ticket_status

router = APIRouter(tags=["agents and integrations"])

AGENT_CATALOG = (
    ("supervisor", "Supervisor Agent", "Routes a validated operation to the right planning or monitoring workflow."),
    ("approval_gate", "Approval Gate", "Pauses sensitive task dispatch until a manager records an approval decision."),
    ("plan_generator", "Plan Generator Agent", "Builds a validated, dependency-aware plan from a role template and optional Gemini suggestions."),
    ("progress_monitor", "Progress Monitor Agent", "Runs the deterministic monitor for approvals, scheduling, stalls, and readiness."),
    ("it_provisioner", "IT Provisioner Agent", "Reconciles IT ticket status through the ITSM MCP service."),
    ("facilities_coordinator", "Facilities Coordinator Agent", "Reconciles Facilities ticket status through the ITSM MCP service."),
    ("hris_coordinator", "HRIS Coordinator Agent", "Reconciles onboarding readiness with the HRIS MCP service."),
)


def _agent_card(name: str, title: str, responsibility: str, runs: list[AgentExecution]) -> dict:
    latest = max(runs, key=lambda row: row.completed_at, default=None)
    return {
        "name": name,
        "title": title,
        "responsibility": responsibility,
        "status": "waiting for approval" if latest and latest.status == "interrupted" else "idle",
        "last_execution_at": latest.completed_at.isoformat() if latest else None,
        "execution_count": len(runs),
        "successful_operations": sum(row.status == "succeeded" for row in runs),
        "partial_operations": sum(row.status == "partial" for row in runs),
        "failed_operations": sum(row.status == "failed" for row in runs),
        "recent_summary": latest.summary if latest else "No executions recorded yet.",
    }


@router.get("/agents")
def list_agents(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    executions = session.exec(select(AgentExecution).order_by(AgentExecution.completed_at.desc())).all()
    return [_agent_card(name, title, responsibility, [item for item in executions if item.agent_name == name])
            for name, title, responsibility in AGENT_CATALOG]


@router.get("/agents/activity")
def agent_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    agent: str | None = Query(None, max_length=80),
    status: str | None = Query(None, pattern="^(succeeded|partial|failed|interrupted)$"),
    session: Session = Depends(get_session),
    _user=Depends(require_roles("ADMIN", "HR")),
):
    query = select(AgentExecution)
    if agent:
        query = query.where(AgentExecution.agent_name == agent)
    if status:
        query = query.where(AgentExecution.status == status)
    all_rows = session.exec(query.order_by(AgentExecution.completed_at.desc())).all()
    rows = all_rows[(page - 1) * page_size:page * page_size]
    return {
        "items": [{
            "id": row.public_id,
            "thread_id": row.thread_id,
            "hire_id": row.hire_id,
            "agent": row.agent_name,
            "operation": row.operation,
            "status": row.status,
            "summary": row.summary,
            "error_code": row.error_code,
            "started_at": row.started_at.isoformat(),
            "completed_at": row.completed_at.isoformat(),
        } for row in rows],
        "total": len(all_rows),
        "page": page,
        "page_size": page_size,
    }


@router.post("/agents/monitor/run")
def run_agent_monitor(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    from app.services.orchestrator import monitor_tick
    completed = monitor_tick(session)
    latest = session.exec(select(AgentExecution).where(AgentExecution.operation == "monitor")
                          .order_by(AgentExecution.completed_at.desc())).first()
    return {"completed": completed, "thread_id": latest.thread_id if latest else None}


def _check_result(service: str, result: dict) -> dict:
    healthy = result.get("error") not in {"service_unavailable", "invalid_tool_response"}
    return {"name": service, "status": "healthy" if healthy else "unavailable",
            "mock": True, "checked_at": datetime.utcnow().isoformat(),
            "detail": "MCP tool responded" if healthy else "MCP tool call failed"}


@router.get("/integrations/status")
def integration_status(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    from app.services.scheduler import scheduler_status
    itsm = _check_result("ITSM MCP", get_ticket_status("ONBOARDFLOW-HEALTH-CHECK"))
    hris = _check_result("HRIS MCP", get_new_hire(-1))
    outbox = session.exec(select(OutboxItem)).all()
    scheduler = scheduler_status()
    return {
        "integrations": [itsm, hris, {
            "name": "Gemini API", "status": "configured" if settings.GEMINI_API_KEY else "fallback mode",
            "mock": False, "checked_at": datetime.utcnow().isoformat(),
            "detail": settings.GEMINI_MODEL if settings.GEMINI_API_KEY else "Optional; deterministic templates are active.",
        }],
        "scheduler": scheduler,
        "outbox": {"pending": len(outbox), "retries": sum(item.retry_count for item in outbox)},
    }


@router.get("/integrations/outbox")
def list_outbox(session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN", "HR"))):
    items = session.exec(select(OutboxItem).order_by(OutboxItem.created_at.desc())).all()
    return [{
        "id": item.id,
        "hire": (hire.name if (hire := session.get(Hire, item.hire_id)) else "Unknown hire"),
        "task": (task.title if (task := session.get(Task, item.task_id)) else item.title),
        "team": item.team,
        "retry_count": item.retry_count,
        "created_at": item.created_at.isoformat(),
    } for item in items]


@router.post("/integrations/outbox/{item_id}/retry")
def retry_outbox(item_id: int, session: Session = Depends(get_session), _user=Depends(require_roles("ADMIN"))):
    item = session.get(OutboxItem, item_id)
    if not item:
        raise HTTPException(404, "Outbox item not found")
    sim_state = session.exec(select(SimState)).first()
    if sim_state and sim_state.itsm_offline:
        raise HTTPException(409, "ITSM is marked offline; recover the service before retrying")
    from app.services.orchestrator import get_current_day, retry_outbox_item
    completed = retry_outbox_item(session, item, get_current_day(session))
    return {"status": "dispatched" if completed else "queued", "retry_count": item.retry_count}


@router.post("/integrations/test")
def test_integrations(_user=Depends(require_roles("ADMIN"))):
    itsm = _check_result("ITSM MCP", get_ticket_status("ONBOARDFLOW-HEALTH-CHECK"))
    hris = _check_result("HRIS MCP", get_new_hire(-1))
    return {"results": [itsm, hris]}
