"""Typed gateway for the ITSM and HRIS MCP tools."""
from __future__ import annotations

from typing import Any

from app.config import settings
from app.mcp_clients.stdio import clients


def _call(service: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if settings.MCP_MODE == "inprocess":
        if service == "itsm":
            from mcp_servers import itsm_mcp
            import os
            itsm_mcp.DB_PATH = os.environ.get("ITSM_DB_PATH", itsm_mcp.DB_PATH)
            functions = {
                "create_ticket": itsm_mcp._create_ticket_impl,
                "get_ticket_status": itsm_mcp._get_status_impl,
                "update_ticket_status": itsm_mcp._update_status_impl,
                "cancel_ticket": itsm_mcp._cancel_ticket_impl,
                "update_ticket_details": itsm_mcp._update_ticket_details_impl,
                "set_service_offline": itsm_mcp._set_offline_impl,
                "reset_service": itsm_mcp._reset_impl,
            }
        else:
            from mcp_servers import hris_mcp
            import os
            hris_mcp.DB_PATH = os.environ.get("HRIS_DB_PATH", hris_mcp.DB_PATH)
            functions = {
                "get_new_hire": hris_mcp.get_new_hire_impl,
                "upsert_new_hire": hris_mcp.upsert_new_hire_impl,
                "update_onboarding_status": hris_mcp.update_onboarding_status_impl,
                "reset_service": hris_mcp.reset_impl,
            }
        return functions[tool_name](**arguments)
    return clients.call(service, tool_name, arguments)


def set_itsm_offline(offline: bool) -> dict[str, Any]:
    return _call("itsm", "set_service_offline", {"offline": offline})


def reset_mcp_services() -> None:
    _call("itsm", "reset_service", {})
    _call("hris", "reset_service", {})


def create_ticket(idempotency_key: str, title: str, team: str, estimate_days: int) -> dict[str, Any]:
    return _call("itsm", "create_ticket", {
        "idempotency_key": idempotency_key, "title": title, "team": team, "estimate_days": estimate_days,
    })


def get_ticket_status(ticket_id: str) -> dict[str, Any]:
    return _call("itsm", "get_ticket_status", {"ticket_id": ticket_id})


def update_ticket_status(ticket_id: str, ticket_status: str) -> dict[str, Any]:
    return _call("itsm", "update_ticket_status", {"ticket_id": ticket_id, "status": ticket_status})


def cancel_ticket(ticket_id: str) -> dict[str, Any]:
    return _call("itsm", "cancel_ticket", {"ticket_id": ticket_id})


def update_ticket_details(ticket_id: str, title: str, estimate_days: int) -> dict[str, Any]:
    return _call("itsm", "update_ticket_details", {
        "ticket_id": ticket_id, "title": title, "estimate_days": estimate_days,
    })


def get_new_hire(hire_id: int) -> dict[str, Any]:
    return _call("hris", "get_new_hire", {"hire_id": hire_id})


def upsert_new_hire(hire_id: int, name: str, role: str, department: str, start_day: int) -> dict[str, Any]:
    return _call("hris", "upsert_new_hire", {
        "hire_id": hire_id, "name": name, "role": role, "department": department, "start_day": start_day,
    })


def update_onboarding_status(hire_id: int, status: str, readiness: float) -> dict[str, Any]:
    return _call("hris", "update_onboarding_status", {"hire_id": hire_id, "status": status, "readiness": readiness})
