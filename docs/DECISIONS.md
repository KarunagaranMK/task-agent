# Engineering decisions

## 2026-11-23 — Preserve the existing prototype

- **Decision:** Extend the repository's existing FastAPI/SQLModel and React/Vite application rather than replacing it.
- **Why:** It already contains the critical path planner, orchestration services, seeded scenarios, and a 53-test backend suite that align with the brief.
- **Alternative considered:** Start a new monorepo and port the prototype first. That would add migration risk before the current behavior is understood.

## 2026-11-23 — Keep optional Gemini but make dependency pins compatible

- **Decision:** Pin `google-genai` to the repository's verified 3.6.1 version and allow its compatible Pydantic, HTTPX, and AnyIO ranges.
- **Why:** The previous pins (`pydantic==2.9.2`, `httpx==0.27.2`, `anyio==4.6.2`) cannot resolve with the current Gemini SDK, so a clean local setup fails before the app starts.
- **Alternative considered:** Remove the Gemini SDK and leave all LLM integrations unimplemented. The product brief requires optional Gemini support, so the compatible SDK remains installed.

## 2026-11-23 — Pin AnyIO to the SDK-compatible range

- **Decision:** Pin `anyio==4.10.0` alongside `google-genai==3.6.1`.
- **Why:** This satisfies the selected SDK's `httpx2` dependency while replacing the incompatible earlier 4.6.2 pin. The standalone health test and the full 53-test suite pass under the installed 4.10.0 runtime with local execution enabled.
- **Alternative considered:** Leave AnyIO unconstrained. That allowed pip to select 4.16.0, while the local sandbox also stalled TestClient startup. The approved local execution rerun passed; because sandbox restrictions affected the test, no claim is made that AnyIO alone caused the hang. The strict SDK-compatible pin keeps clean installs deterministic.

## 2026-11-23 — Route API calls through the Vite same-origin proxy

- **Decision:** Use `/api` in the frontend and proxy it to the existing root-level FastAPI routes during development.
- **Why:** This keeps local requests same-origin and avoids hardcoding a separate host in browser code.
- **Alternative considered:** Direct calls to `http://localhost:8000`. This breaks the requested proxy pattern and requires CORS in local development.

## 2026-11-23 — Make local setup repeatable without reseeding on every launch

- **Decision:** Store the dependency requirements hash in the local virtual environment and seed only an empty database; `--reset` recreates the demo database.
- **Why:** Reinstalling all packages and adding duplicate demo hires on every invocation makes the one-command flow slow and confusing.
- **Alternative considered:** Always install and seed at every run. That is simpler but not safe for a persistent local database.

## 2026-11-23 — Use an offline-safe system font stack until self-hosted fonts are added

- **Decision:** Keep the initial interface on system UI fonts and do not load fonts from a public CDN.
- **Why:** The brief requires a local-first application that still renders without a network connection.
- **Alternative considered:** Import a hosted font at runtime. That would fail on offline and restricted networks.

## 2026-11-23 — Keep schema changes under Alembic and bootstrap local access through demo seeding

- **Decision:** Use Alembic for all schema changes, keep demo accounts behind `DEMO_MODE`, and provide a prompted `create-admin` command for non-demo installs.
- **Why:** The app should start predictably after `run.py` migrates the database, without hidden `create_all` behavior. Invited users set their own password through a hashed, one-use token delivered into the local mail outbox.
- **Alternative considered:** Create or alter tables implicitly during API startup and email passwords directly. That would make deployments harder to reason about and expose credentials.

## 2026-11-23 — Keep refresh secrets opaque and audit authentication events separately

- **Decision:** Store only SHA-256 digests of random refresh and one-time tokens; rotate refresh tokens on every use; persist security-specific events in a dedicated audit table.
- **Why:** Tokens can be revoked or replay-detected without storing bearer secrets, while auth events do not require a hire-specific foreign key.
- **Alternative considered:** Reuse hire activity records. Those records require a hire id and would misrepresent account actions.

## 2026-11-23 — Use a memory token bucket alongside durable account lockout

- **Decision:** Limit repeated sign-in attempts by client IP and normalized account key in the single-process local server, and retain the per-account five-failure lockout in the database.
- **Why:** This adds a basic per-IP and per-account throttle without another service in the local-first setup.
- **Alternative considered:** Add Redis-backed slowapi immediately. That adds infrastructure and conflicts with the Python-and-Node-only first-run requirement; production multi-process rate limiting remains a hardening item.

## 2026-11-23 — Keep the current simulation model while adding a pure business calendar

- **Decision:** Add a timezone-aware clock and holiday/weekend calendar as a standalone deterministic service, while preserving the prototype's integer `start_day` and demo clock for existing workflows.
- **Why:** It gives scheduling code correct business-day primitives without breaking the existing scenario data and UI before downstream APIs are migrated.
- **Alternative considered:** Replace every day counter with dates in this phase. That would mix a broad schema/UI migration into the CPM fixes and risk breaking the working prototype.

## 2026-11-23 — Treat zero and negative deadlines as real deadline violations

- **Decision:** CPM always uses the supplied deadline, including zero or negative values, and validates duplicate or unknown task dependencies before calculation.
- **Why:** Substituting project finish time for an expired deadline concealed negative slack and falsely showed a hire as on track.
- **Alternative considered:** Preserve the old fallback for nonpositive deadlines. That makes a due or overdue hire appear healthy.

## 2026-11-23 — Define what-if delay as added remaining business-day duration

- **Decision:** A what-if adds 0–10 business days to the selected open task's remaining duration and reruns CPM without mutating stored tasks.
- **Why:** This produces a simple, deterministic scenario calculation that exposes projected-ready delta and the resulting critical path.
- **Alternative considered:** Temporarily edit the database task and roll it back. That risks leaking scenario state through concurrent requests.

## 2026-11-23 — Use the maintained MCP Python SDK 1.x line for FastMCP stdio

- **Decision:** Use `mcp[cli]>=1.28,<2`, the SDK's FastMCP server API, and persistent stdio sessions; bump Uvicorn to a compatible `>=0.31.1` range.
- **Why:** MCP 1.x remains the supported maintenance line for existing FastMCP code and provides the required stdio transport. The initial dependency attempt showed the existing Uvicorn 0.30.6 pin could not resolve with MCP.
- **Alternative considered:** Use the SDK's v2 API, which renames FastMCP and changes imports, or use the separate `fastmcp` distribution. The pinned 1.x API matches the brief and keeps this implementation on the official Python SDK.

## 2026-11-23 — Keep MCP systems of record separate from the application read model

- **Decision:** The mock ITSM and HRIS services own persistent SQLite records behind MCP tools; the app mirrors accepted ticket data into its local tables for queries and UI display.
- **Why:** Tool calls stay the only path for external-system reads/writes, while the existing UI/API can keep its current read model.
- **Alternative considered:** Continue creating tickets directly in the app database. That would bypass the integration boundary and make outage/idempotency behavior impossible to validate independently.

## Known decisions still pending

- The deterministic in-process MCP adapters remain until persistent stdio client tests are implemented.
- The demo role selector remains a visual prototype; it does not enforce backend RBAC.
- The optional LangGraph adapter stays disabled until the default orchestrator passes its expanded test suite.
- The local mail outbox is the delivery mechanism for development; SMTP configuration and real delivery remain optional and unimplemented.
