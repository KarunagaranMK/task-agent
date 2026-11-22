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
    from fastmcp import FastMCP
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
    conn.commit()
    return conn


def _is_offline() -> bool:
    return os.environ.get("ITSM_OFFLINE", "false").lower() == "true"


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
        """Update ticket status."""
        if _is_offline():
            return {"error": "service_unavailable"}
        db = _get_db()
        try:
            db.execute("UPDATE tickets SET status = ? WHERE ticket_id = ?", (status, ticket_id))
            db.commit()
            return {"ticket_id": ticket_id, "status": status}
        finally:
            db.close()

    if __name__ == "__main__":
        mcp.run(transport="stdio")
