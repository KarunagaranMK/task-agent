# Assumptions

> Decisions made without explicit specification. Verify / override as needed before production.

## A1 — Simulated Clock (SIM_MODE)
Default `SIM_MODE=true`. Time advances only when "Advance Day" is clicked in the demo panel. This makes the demo completely deterministic and presenter-controlled. Real-time APScheduler mode is wired but not the demo default.

## A2 — MCP Transport (In-Process vs Stdio)
The MCP server files (`itsm_mcp.py`, `hris_mcp.py`) are runnable as proper FastMCP stdio processes for production. For the MVP demo the orchestrator calls the same underlying Python functions directly (no subprocess management), which avoids Windows stdio-process reliability issues in a demo context. Zero agent code changes are needed to switch to subprocess MCP — only the client wiring changes.

## A3 — LangGraph Dropped for Deterministic Orchestrator
LangGraph StateGraph + SqliteSaver checkpointing had checkpoint schema conflicts across library versions. The same node structure (plan_generator → supervisor → it_provisioner / facilities_coordinator / hr_agent → approval_gate → progress_monitor) is implemented as direct Python function calls in `orchestrator.py`. This is simpler, fully testable, and avoids checkpoint corruption. Documented as a known tradeoff.

## A4 — LLM is Fully Optional
`GEMINI_API_KEY` defaults to empty. All LLM paths (extra tasks in planner, risk explanation, escalation messages) have Pydantic-validated template fallbacks. The app runs with 100% functionality without any API key.

## A5 — Stall Threshold = 2 Idle Days
A dispatched task with no `last_activity_day` update for ≥ 2 days (or elapsed > duration) is considered stalled. This matches the spec; adjust via constants in `cpm.py`.

## A6 — Act Only on Critical / Near-Critical Tasks
Only tasks with `slack ≤ min_slack + 1` trigger escalation and rescheduling. All other stalled tasks get `flag=watch` only. This prevents alert fatigue.

## A7 — Single Fallback Per Task
Only `it:laptop` has a fallback ("Issue Loaner Laptop", 1 day) in the Data Analyst and Software Engineer templates. Additional fallbacks can be added to `ROLE_TEMPLATES` in `planner.py`.

## A8 — SQLite (Postgres-Ready)
`DATABASE_URL` env var controls the DB. SQLModel/SQLAlchemy makes swapping to Postgres a one-line change (`postgresql+psycopg2://...`). No schema migrations are wired (Alembic not included in MVP scope).

## A9 — Auth is Demo-Only
The role switcher (HR / Manager / IT / Facilities) in the UI is for demo presentation. No real authentication, session, or RBAC is implemented.

## A10 — Experiment is Illustrative
The Monte Carlo simulation uses a simplified task model (5 tasks, top-3 sequential = critical path). It is documented honestly in the UI and in `docs/REVIEW.md`. Real numbers require a production deployment.

## A11 — `depends_on` Stored as JSON String
SQLite doesn't support array columns. `Task.depends_on` is stored as a JSON string (`"[]"`) and exposed as a list via the `depends_on_list` property. This is transparent to all callers.

## A12 — Frontend API URL
`VITE_API_URL` defaults to `http://localhost:8000`. In Docker Compose the frontend nginx proxy forwards `/api` to the backend container.
