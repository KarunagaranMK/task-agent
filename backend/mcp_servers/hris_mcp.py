#!/usr/bin/env python3
"""
HRIS Mock MCP Server using FastMCP.
Provides get_new_hire and update_onboarding_status tools.
Run as: python mcp_servers/hris_mcp.py
"""
import sqlite3
import os

try:
    from mcp.server.fastmcp import FastMCP
    mcp = FastMCP("hris-mcp")
    HAS_MCP = True
except ImportError:
    HAS_MCP = False
    mcp = None

DB_PATH = os.environ.get("HRIS_DB_PATH", "./hris_mock.db")


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hires (
            hire_id INTEGER PRIMARY KEY,
            name TEXT,
            role TEXT,
            department TEXT,
            start_day INTEGER,
            status TEXT,
            readiness REAL
        )
    """)
    conn.commit()
    return conn


def get_new_hire_impl(hire_id: int) -> dict:
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM hires WHERE hire_id = ?", (hire_id,)).fetchone()
        return dict(row) if row else {"error": "not_found"}
    finally:
        db.close()


def upsert_new_hire_impl(hire_id: int, name: str, role: str, department: str, start_day: int) -> dict:
    db = _get_db()
    try:
        db.execute(
            "INSERT INTO hires (hire_id, name, role, department, start_day, status, readiness) VALUES (?, ?, ?, ?, ?, 'on_track', 0) "
            "ON CONFLICT(hire_id) DO UPDATE SET name=excluded.name, role=excluded.role, department=excluded.department, start_day=excluded.start_day",
            (hire_id, name, role, department, start_day),
        )
        db.commit()
        return {"hire_id": hire_id, "status": "on_track", "readiness": 0}
    finally:
        db.close()


def update_onboarding_status_impl(hire_id: int, status: str, readiness: float) -> dict:
    db = _get_db()
    try:
        db.execute(
            "INSERT INTO hires (hire_id, name, role, department, start_day, status, readiness) VALUES (?, '', '', '', 0, ?, ?) "
            "ON CONFLICT(hire_id) DO UPDATE SET status=excluded.status, readiness=excluded.readiness",
            (hire_id, status, readiness),
        )
        db.commit()
        return {"hire_id": hire_id, "status": status, "readiness": readiness}
    finally:
        db.close()


def reset_impl() -> dict:
    db = _get_db()
    try:
        db.execute("DELETE FROM hires")
        db.commit()
        return {"status": "reset"}
    finally:
        db.close()


if HAS_MCP:
    @mcp.tool()
    def get_new_hire(hire_id: int) -> dict:
        """Retrieve new hire record from HRIS."""
        return get_new_hire_impl(hire_id)

    @mcp.tool()
    def upsert_new_hire(hire_id: int, name: str, role: str, department: str, start_day: int) -> dict:
        """Create or synchronize the local HRIS mock record for a hire."""
        return upsert_new_hire_impl(hire_id, name, role, department, start_day)

    @mcp.tool()
    def update_onboarding_status(hire_id: int, status: str, readiness: float) -> dict:
        """Update hire onboarding status in HRIS."""
        return update_onboarding_status_impl(hire_id, status, readiness)

    @mcp.tool()
    def reset_service() -> dict:
        """Reset local mock HRIS data for the demo scenario."""
        return reset_impl()

    if __name__ == "__main__":
        mcp.run(transport="stdio")
