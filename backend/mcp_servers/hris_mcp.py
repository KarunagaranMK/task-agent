#!/usr/bin/env python3
"""
HRIS Mock MCP Server using FastMCP.
Provides get_new_hire and update_onboarding_status tools.
Run as: python mcp_servers/hris_mcp.py
"""
import sqlite3
import os

try:
    from fastmcp import FastMCP
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


if HAS_MCP:
    @mcp.tool()
    def get_new_hire(hire_id: int) -> dict:
        """Retrieve new hire record from HRIS."""
        db = _get_db()
        try:
            row = db.execute("SELECT * FROM hires WHERE hire_id = ?", (hire_id,)).fetchone()
            return dict(row) if row else {"error": "not_found"}
        finally:
            db.close()

    @mcp.tool()
    def update_onboarding_status(hire_id: int, status: str, readiness: float) -> dict:
        """Update hire onboarding status in HRIS."""
        db = _get_db()
        try:
            db.execute(
                "INSERT OR REPLACE INTO hires (hire_id, status, readiness) VALUES (?, ?, ?)",
                (hire_id, status, readiness),
            )
            db.commit()
            return {"hire_id": hire_id, "status": status, "readiness": readiness}
        finally:
            db.close()

    if __name__ == "__main__":
        mcp.run(transport="stdio")
