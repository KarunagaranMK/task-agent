"""Long-lived synchronous facade over MCP's async stdio client sessions."""
from __future__ import annotations

import asyncio
import atexit
import json
import os
import sys
import threading
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


BACKEND_DIR = Path(__file__).resolve().parents[2]
SERVER_FILES = {
    "itsm": BACKEND_DIR / "mcp_servers" / "itsm_mcp.py",
    "hris": BACKEND_DIR / "mcp_servers" / "hris_mcp.py",
}


class PersistentMCPClients:
    """Maintain one stdio process/session per mock service for app lifetime."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, name="onboardiq-mcp", daemon=True)
        self._thread.start()
        self._ready.wait(timeout=5)
        self._sessions: dict[str, tuple[AsyncExitStack, ClientSession]] = {}
        self._call_locks: dict[str, asyncio.Lock] = {}

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._ready.set()
        self._loop.run_forever()

    async def _ensure_session(self, service: str) -> ClientSession:
        existing = self._sessions.get(service)
        if existing:
            return existing[1]
        server_file = SERVER_FILES[service]
        env = os.environ.copy()
        db_dir = Path(env.get("ONBOARDIQ_MCP_DB_DIR", str(BACKEND_DIR))).resolve()
        db_dir.mkdir(parents=True, exist_ok=True)
        env["ITSM_DB_PATH"] = str(db_dir / "itsm_mock.db")
        env["HRIS_DB_PATH"] = str(db_dir / "hris_mock.db")
        params = StdioServerParameters(command=sys.executable, args=[str(server_file)], env=env)
        stack = AsyncExitStack()
        await stack.__aenter__()
        read_stream, write_stream = await stack.enter_async_context(stdio_client(params))
        session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
        await session.initialize()
        self._sessions[service] = (stack, session)
        return session

    async def _call(self, service: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        lock = self._call_locks.setdefault(service, asyncio.Lock())
        async with lock:
            session = await self._ensure_session(service)
            try:
                result = await session.call_tool(tool_name, arguments)
            except Exception:
                stack, _ = self._sessions.pop(service, (None, None))
                if stack is not None:
                    await stack.aclose()
                return {"error": "service_unavailable"}
        structured = getattr(result, "structuredContent", None) or getattr(result, "structured_content", None)
        if isinstance(structured, dict):
            return structured
        for item in getattr(result, "content", []):
            text = getattr(item, "text", None)
            if text:
                try:
                    decoded = json.loads(text)
                    if isinstance(decoded, dict):
                        return decoded
                except json.JSONDecodeError:
                    continue
        if getattr(result, "isError", False):
            return {"error": "service_unavailable"}
        return {"error": "invalid_tool_response"}

    def call(self, service: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if service not in SERVER_FILES:
            raise ValueError(f"Unknown MCP service: {service}")
        future = asyncio.run_coroutine_threadsafe(self._call(service, tool_name, arguments), self._loop)
        try:
            return future.result(timeout=30)
        except Exception:
            return {"error": "service_unavailable"}

    async def _close_sessions(self) -> None:
        for stack, _session in list(self._sessions.values()):
            await stack.aclose()
        self._sessions.clear()

    def close(self) -> None:
        if not self._loop.is_running():
            return
        future = asyncio.run_coroutine_threadsafe(self._close_sessions(), self._loop)
        try:
            future.result(timeout=5)
        except Exception:
            pass
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)


class LazyPersistentMCPClients:
    """Only create the event-loop thread when stdio transport is actually used."""

    def __init__(self) -> None:
        self._client: PersistentMCPClients | None = None
        self._lock = threading.Lock()

    def _get_client(self) -> PersistentMCPClients:
        with self._lock:
            if self._client is None:
                self._client = PersistentMCPClients()
            return self._client

    def call(self, service: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self._get_client().call(service, tool_name, arguments)

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None


clients = LazyPersistentMCPClients()
atexit.register(clients.close)
