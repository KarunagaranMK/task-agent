#!/usr/bin/env python3
"""
ITSM Mock MCP Server using FastMCP.
Provides create_ticket, get_ticket_status, update_ticket_status tools.
Run as: python mcp_servers/itsm_mcp.py
"""
import uuid
import sqlite3
import os
from datetime import datetime

try:
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("itsm-mcp")
    HAS_MCP = True
except ImportError:
    HAS_MCP = False
    mcp = None

DB_PATH = os.environ.get("ITSM_DB_PATH", "./itsm_mock.db")


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tickets (
            ticket_id TEXT PRIMARY KEY,
            idempotency_key TEXT UNIQUE,
            title TEXT,
            team TEXT,
            estimate_days INTEGER,
            status TEXT DEFAULT 'open',
            created_at TEXT
        )
    """)
    conn.execute("CREATE TABLE IF NOT EXISTS service_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), offline INTEGER NOT NULL DEFAULT 0)")
    conn.execute("INSERT OR IGNORE INTO service_state (singleton, offline) VALUES (1, 0)")
    conn.commit()
    return conn


def _is_offline() -> bool:
    db = _get_db()
    try:
        return bool(db.execute("SELECT offline FROM service_state WHERE singleton=1").fetchone()[0])
    finally:
        db.close()


def _set_offline_impl(offline: bool) -> dict:
    db = _get_db()
    try:
        db.execute("UPDATE service_state SET offline=? WHERE singleton=1", (int(offline),))
        db.commit()
        return {"offline": offline}
    finally:
        db.close()


def _reset_impl() -> dict:
    db = _get_db()
    try:
        db.execute("DELETE FROM tickets")
        db.execute("UPDATE service_state SET offline=0 WHERE singleton=1")
        db.commit()
        return {"status": "reset"}
    finally:
        db.close()


def _create_ticket_impl(idempotency_key: str, title: str, team: str, estimate_days: int) -> dict:
    if _is_offline():
        return {"error": "service_unavailable"}
    db = _get_db()
    try:
        existing = db.execute(
            "SELECT * FROM tickets WHERE idempotency_key = ?", (idempotency_key,)
        ).fetchone()
        if existing:
            return {"ticket_id": existing["ticket_id"], "status": existing["status"], "idempotent": True}
        ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
        db.execute(
            "INSERT INTO tickets VALUES (?, ?, ?, ?, ?, 'open', ?)",
            (ticket_id, idempotency_key, title, team, estimate_days, datetime.utcnow().isoformat()),
        )
        db.commit()
        return {"ticket_id": ticket_id, "status": "open", "idempotent": False}
    finally:
        db.close()


def _get_status_impl(ticket_id: str) -> dict:
    if _is_offline():
        return {"error": "service_unavailable"}
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM tickets WHERE ticket_id = ?", (ticket_id,)).fetchone()
        if not row:
            return {"error": "not_found"}
        return {"ticket_id": row["ticket_id"], "status": row["status"], "team": row["team"]}
    finally:
        db.close()


def _update_status_impl(ticket_id: str, status: str) -> dict:
    if _is_offline():
        return {"error": "service_unavailable"}
    if status not in {"open", "in_progress", "done", "stalled", "blocked", "cancelled"}:
        return {"error": "invalid_status"}
    db = _get_db()
    try:
        result = db.execute("UPDATE tickets SET status=? WHERE ticket_id=?", (status, ticket_id))
        db.commit()
        if result.rowcount == 0:
            return {"error": "not_found"}
        return {"ticket_id": ticket_id, "status": status}
    finally:
        db.close()


def _cancel_ticket_impl(ticket_id: str) -> dict:
    return _update_status_impl(ticket_id, "cancelled")


def _update_ticket_details_impl(ticket_id: str, title: str, estimate_days: int) -> dict:
    if _is_offline():
        return {"error": "service_unavailable"}
    db = _get_db()
    try:
        result = db.execute("UPDATE tickets SET title=?, estimate_days=? WHERE ticket_id=?", (title, estimate_days, ticket_id))
        db.commit()
        if result.rowcount == 0:
            return {"error": "not_found"}
        return {"ticket_id": ticket_id, "title": title, "estimate_days": estimate_days}
    finally:
        db.close()


if HAS_MCP:
    @mcp.tool()
    def create_ticket(idempotency_key: str, title: str, team: str, estimate_days: int) -> dict:
        """Create an ITSM ticket. Idempotent on idempotency_key."""
        return _create_ticket_impl(idempotency_key, title, team, estimate_days)

    @mcp.tool()
    def get_ticket_status(ticket_id: str) -> dict:
        """Get status of an ITSM ticket."""
        return _get_status_impl(ticket_id)

    @mcp.tool()
    def update_ticket_status(ticket_id: str, status: str) -> dict:
        """Update ticket status through the mock ITSM boundary."""
        return _update_status_impl(ticket_id, status)

    @mcp.tool()
    def cancel_ticket(ticket_id: str) -> dict:
        """Cancel a ticket through the mock ITSM boundary."""
        return _cancel_ticket_impl(ticket_id)

    @mcp.tool()
    def update_ticket_details(ticket_id: str, title: str, estimate_days: int) -> dict:
        """Update the details for an existing ITSM ticket."""
        return _update_ticket_details_impl(ticket_id, title, estimate_days)

    @mcp.tool()
    def set_service_offline(offline: bool) -> dict:
        """Demo-only chaos switch for the mock ITSM service."""
        return _set_offline_impl(offline)

    @mcp.tool()
    def reset_service() -> dict:
        """Reset local mock ITSM data for the demo scenario."""
        return _reset_impl()

    if __name__ == "__main__":
        mcp.run(transport="stdio")
