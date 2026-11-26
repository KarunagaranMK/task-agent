"""Supervised LangGraph workflow around the deterministic onboarding services."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any, Literal, TypedDict
from uuid import uuid4

# Checkpoints contain application state only. Disable permissive MessagePack
# deserialization before the LangGraph serializer is created.
os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from sqlmodel import Session, select

from app.domain.models import (
    AgentExecution,
    Hire,
    Task,
    TaskStatus,
    Ticket,
)
from app.mcp_clients.tools import (
    get_new_hire,
    get_ticket_status,
    update_onboarding_status,
)


class WorkflowState(TypedDict, total=False):
    operation: Literal["plan", "monitor"]
    thread_id: str
    hire_id: int | None
    role: str | None
    plan: list[dict[str, Any]]
    monitored: bool
    it_sync: dict[str, int]
    facilities_sync: dict[str, int]
    hris_sync: dict[str, int]


class WorkflowContext(TypedDict):
    session: Session


_lock = RLock()
_graph = None
_checkpoint_connection: sqlite3.Connection | None = None


def _checkpoint_path() -> Path:
    from app.config import settings
    configured = (settings.LANGGRAPH_CHECKPOINT_DB or os.getenv("LANGGRAPH_CHECKPOINT_DB", "")).strip()
    path = Path(configured) if configured else Path("onboarding.checkpoints.sqlite")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def _record(
    state: WorkflowState,
    runtime: Runtime[WorkflowContext],
    agent: str,
    summary: str,
    started_at: datetime,
    *,
    status: str = "succeeded",
    error_code: str | None = None,
    hire_id: int | None = None,
) -> None:
    session = runtime.context["session"]
    session.add(AgentExecution(
        thread_id=state["thread_id"],
        hire_id=hire_id if hire_id is not None else state.get("hire_id"),
        agent_name=agent,
        operation=state["operation"],
        status=status,
        summary=summary[:500],
        error_code=error_code,
        started_at=started_at,
        completed_at=datetime.utcnow(),
    ))
    session.flush()


def _supervisor(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, Any]:
    started = datetime.utcnow()
    operation = state["operation"]
    route = "plan generation" if operation == "plan" else "progress monitoring with team and HRIS workers"
    _record(state, runtime, "supervisor", f"Routed {operation} workflow to {route}.", started)
    return {}


def _planner(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, Any]:
    started = datetime.utcnow()
    from app.services.orchestrator import _plan_spec_for_role_direct

    plan = _plan_spec_for_role_direct(runtime.context["session"], state["role"] or "default", state.get("hire_id"))
    _record(state, runtime, "plan_generator", f"Validated {len(plan.tasks)} tasks for role {state.get('role') or 'default'}.", started)
    return {"plan": [task.model_dump(mode="json") for task in plan.tasks]}


def _progress_monitor(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, Any]:
    started = datetime.utcnow()
    from app.services.orchestrator import _monitor_tick_body

    _monitor_tick_body(runtime.context["session"])
    _record(state, runtime, "progress_monitor", "Completed deterministic schedule, readiness, and stall checks.", started)
    return {"monitored": True}


def _team_ticket_sync(state: WorkflowState, runtime: Runtime[WorkflowContext], team: str) -> dict[str, int]:
    started = datetime.utcnow()
    session = runtime.context["session"]
    checked = updated = failed = 0
    tickets = session.exec(select(Ticket).where(Ticket.team == team, Ticket.ticket_id.is_not(None))).all()
    for ticket in tickets:
        checked += 1
        result = get_ticket_status(ticket.ticket_id)
        status = result.get("status")
        if result.get("error") or status not in {"open", "in_progress", "done", "stalled", "blocked", "cancelled"}:
            failed += 1
            continue
        # An external "done" means the department has finished its work. HR
        # must still accept the handoff before the onboarding task becomes done.
        if status == "done":
            continue
        if ticket.status != status:
            ticket.status = status
            ticket.updated_at = datetime.utcnow()
            session.add(ticket)
            task = session.get(Task, ticket.task_id) if ticket.task_id else None
            if task and status == "done" and task.status != TaskStatus.done:
                task.status = TaskStatus.done
                session.add(task)
            updated += 1
    summary = f"Reconciled {checked} {team} MCP tickets; {updated} changed, {failed} unavailable or invalid."
    agent = "it_provisioner" if team == "IT" else "facilities_coordinator"
    _record(state, runtime, agent, summary, started, status="partial" if failed else "succeeded")
    return {"checked": checked, "updated": updated, "failed": failed}


def _it_agent(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, int]:
    return _team_ticket_sync(state, runtime, "IT")


def _facilities_agent(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, int]:
    return _team_ticket_sync(state, runtime, "Facilities")


def _hris_agent(state: WorkflowState, runtime: Runtime[WorkflowContext]) -> dict[str, int]:
    started = datetime.utcnow()
    session = runtime.context["session"]
    checked = updated = failed = 0
    hires = session.exec(select(Hire).where(Hire.status.not_in(["paused", "cancelled"]))).all()
    for hire in hires:
        checked += 1
        current = get_new_hire(hire.id or 0)
        if current.get("error") not in (None, "not_found"):
            failed += 1
            continue
        if current.get("status") != str(hire.status) or float(current.get("readiness", -1)) != float(hire.readiness):
            result = update_onboarding_status(hire.id or 0, str(hire.status), float(hire.readiness))
            if result.get("error"):
                failed += 1
            else:
                updated += 1
    _record(state, runtime, "hris_coordinator", f"Reconciled {checked} HRIS records; {updated} updated, {failed} unavailable.", started,
            status="partial" if failed else "succeeded")
    return {"checked": checked, "updated": updated, "failed": failed}


def _route(state: WorkflowState) -> str:
    return "plan_generator_agent" if state["operation"] == "plan" else "progress_monitor_agent"


def _build_graph(checkpointer: SqliteSaver):
    builder = StateGraph(WorkflowState, context_schema=WorkflowContext)
    builder.add_node("supervisor", _supervisor)
    builder.add_node("plan_generator_agent", _planner)
    builder.add_node("progress_monitor_agent", _progress_monitor)
    builder.add_node("it_provisioner_agent", _it_agent)
    builder.add_node("facilities_coordinator_agent", _facilities_agent)
    builder.add_node("hris_coordinator_agent", _hris_agent)
    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges("supervisor", _route, {
        "plan_generator_agent": "plan_generator_agent",
        "progress_monitor_agent": "progress_monitor_agent",
    })
    builder.add_edge("plan_generator_agent", END)
    builder.add_edge("progress_monitor_agent", "it_provisioner_agent")
    builder.add_edge("it_provisioner_agent", "facilities_coordinator_agent")
    builder.add_edge("facilities_coordinator_agent", "hris_coordinator_agent")
    builder.add_edge("hris_coordinator_agent", END)
    return builder.compile(checkpointer=checkpointer, name="onboardflow_supervisor")


def get_workflow_graph():
    global _graph, _checkpoint_connection
    with _lock:
        if _graph is None:
            connection = sqlite3.connect(str(_checkpoint_path()), check_same_thread=False)
            checkpointer = SqliteSaver(connection, serde=JsonPlusSerializer(allowed_msgpack_modules=[]))
            checkpointer.setup()
            _checkpoint_connection = connection
            _graph = _build_graph(checkpointer)
        return _graph


def run_plan_workflow(session: Session, role: str, hire_id: int | None) -> list[dict[str, Any]]:
    thread_id = f"plan-{hire_id}-{uuid4()}"
    result = get_workflow_graph().invoke(
        {"operation": "plan", "thread_id": thread_id, "hire_id": hire_id, "role": role},
        {"configurable": {"thread_id": thread_id}, "metadata": {"operation": "plan", "hire_id": hire_id}},
        context={"session": session}, durability="sync",
    )
    return result["plan"]


def run_monitor_workflow(session: Session) -> tuple[bool, str]:
    thread_id = f"monitor-{uuid4()}"
    result = get_workflow_graph().invoke(
        {"operation": "monitor", "thread_id": thread_id},
        {"configurable": {"thread_id": thread_id}, "metadata": {"operation": "monitor"}},
        context={"session": session}, durability="sync",
    )
    return bool(result.get("monitored")), thread_id


def checkpoint_status(thread_id: str) -> str:
    graph = get_workflow_graph()
    snapshot = graph.get_state({"configurable": {"thread_id": thread_id}})
    return "interrupted" if snapshot.next else "completed"


def close_workflow_graph() -> None:
    global _graph, _checkpoint_connection
    with _lock:
        _graph = None
        if _checkpoint_connection is not None:
            _checkpoint_connection.close()
            _checkpoint_connection = None
