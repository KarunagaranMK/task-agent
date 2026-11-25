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

## 2026-11-23 — Guard every monitor cycle with a durable lease and one database commit

- **Decision:** Run APScheduler in the FastAPI process, acquire a 60-second SQLite-backed monitor lease for both scheduled and manual ticks, write cycle state in one transaction, and release the lease after completion.
- **Why:** Multiple app workers or a manual demo action must not dispatch the same work concurrently. If the process crashes, the lease expires and the next cycle can resume persisted outbox work.
- **Alternative considered:** Use only APScheduler's in-process `max_instances=1`. That does not coordinate a second process and cannot recover after a crash.

## 2026-11-23 — Reschedule a stalled task by updating its existing ticket

- **Decision:** Apply fallback title and duration to the existing MCP ticket while keeping its ticket ID and idempotency key.
- **Why:** Creating a second ticket with the same `hire:task` idempotency key would return the original ticket, while using a new key could duplicate work. Updating the existing request preserves exactly-once behavior.
- **Alternative considered:** Cancel and recreate the ticket. That introduces a cancellation/recreation gap and ambiguous state if either tool response is lost.

## 2026-11-23 — Use single-use SSE tickets and keep streams role-filtered

- **Decision:** Authenticate `POST /events/ticket` with the in-memory access JWT, persist only a hash of the 60-second token, consume it once when opening `GET /events/stream`, and filter each event against the user's role and ownership.
- **Why:** Browser EventSource cannot attach the bearer header, and a long-lived access token in a URL would be exposed through history and logs.
- **Alternative considered:** Put the access JWT in the stream query string or allow reusable stream tokens. Both increase the impact of accidental URL disclosure.

## 2026-11-23 — Use Gemini only for schema-validated copy suggestions

- **Decision:** Validate additional task suggestions, risk explanations, and escalation drafts with Pydantic; all fall back to local role templates or deterministic messages when there is no key, invalid JSON, or an API error.
- **Why:** LLM text can help explain or communicate but must not choose dependencies, dispatch, escalation eligibility, or access policy.
- **Alternative considered:** Accept arbitrary raw model text and let the model make workflow decisions. That conflicts with the deterministic orchestration boundary.

## Known decisions still pending

- The deterministic in-process MCP adapters remain until persistent stdio client tests are implemented.
- The demo role selector remains a visual prototype; it does not enforce backend RBAC.
- The optional LangGraph adapter stays disabled until the default orchestrator passes its expanded test suite.
- The local mail outbox is the delivery mechanism for development; SMTP configuration and real delivery remain optional and unimplemented.

## 2026-11-23 — Keep the browser event stream ticket-only

- **Decision:** Exclude `/events/stream` from the router-wide bearer dependency while keeping `/events/ticket` individually JWT-protected.
- **Why:** Browser EventSource cannot attach Authorization headers. The 60-second single-use stream ticket is the stream’s authentication credential; applying the global bearer dependency made every browser stream fail with 401.
- **Alternative considered:** Put the access JWT in the stream URL or add a custom fetch-based SSE parser. The URL would expose a longer-lived credential, and custom parsing adds client complexity without improving the existing ticket design.

## 2026-11-23 — Generate frontend contracts directly from FastAPI OpenAPI

- **Decision:** Check in a small standard-library generator that imports the FastAPI schema and emits `components` and `paths` TypeScript contracts, exposed through `npm run typegen:api`.
- **Why:** This keeps API contracts reproducible and aligned with the source schema without adding a frontend runtime dependency or changing the user's already-dirty npm lockfile.
- **Alternative considered:** Add an OpenAPI typegen package to the lockfile. That would mix generated dependency edits with unrelated pre-existing lockfile changes; the local generator needs no additional package.
## 2026-11-24 — Persist personal settings separately from workspace guardrails

- **Decision:** Store each user's profile and notification preferences separately from global service settings; keep preference updates scoped to the authenticated user and audited. A disabled in-app preference suppresses both notification polling results and SSE delivery.
- **Why:** Workspace monitor policy is administrator-owned, while personal settings must not be editable by another user or role.
- **Alternative considered:** Put notification preferences into the global settings map. That would allow accidental cross-user changes and conflate account behavior with organization policy.

## 2026-11-24 — Give each browser QA run its own database and MCP mock store

- **Decision:** Derive isolated SQLite and MCP mock paths from the Playwright process ID, use the regular migration/seed startup, and never pass `--reset` to the app's normal demo database.
- **Why:** Browser runs need deterministic fresh seed data without touching a developer's existing demo database; unique paths also avoid SQLite file-lock races between consecutive runs.
- **Alternative considered:** Delete a fixed QA database before each run. Windows may hold a SQLite handle briefly after a browser process exits, and a shared path makes concurrent runs unsafe.

## 2026-11-24 — Keep hire tables useful at mobile width

- **Decision:** Hide manager, Day 1 and readiness columns below 600 px, keep hire name, status and open action, and collapse the top-bar sign-out control at tablet widths.
- **Why:** Preserve the tasks users need to recognize and act on while preventing a wide desktop table from expanding the page beyond the viewport.
- **Alternative considered:** Force the entire table to scroll horizontally. That pushed the page canvas beyond the device width and obscured the status/action columns.

## 2026-11-24 — Preserve the laptop as Priya's longest critical path

- **Decision:** Give the Data Analyst laptop task a five-business-day estimate and reopen the existing ticket when the monitor applies its loaner fallback.
- **Why:** The acceptance scenario needs a visible laptop critical path, a two-day stall rescue, and actionable follow-through to READY without creating a duplicate ITSM ticket.
- **Alternative considered:** Leave the fallback ticket stalled or create a second ticket. The first would strand the scenario; the second would violate idempotency and could leave duplicate work.

## 2026-11-24 — Publish a versioned API and consistent error envelope

- **Decision:** Expose the same API routers under `/api/v1` and make the frontend use that base path; return HTTP and validation failures as `application/problem+json` with a request ID and field errors, and add baseline browser security headers.
- **Why:** The brief requires a versioned API and a predictable error shape, while the existing clients and local proxy still need a non-breaking path during the transition.
- **Alternative considered:** Move all routes in one breaking migration. Keeping legacy aliases supports existing scripts and seeded acceptance flows while new clients use the versioned contract.

## 2026-11-24 — Resume paused work through the existing ticket identity

- **Decision:** Pause cancels active ITSM tickets and holds remaining tasks; resume reopens each same ticket ID and restores its dispatched task state. Cancellation is terminal, keeps completed work, and requires typing the hire's name in the UI.
- **Why:** This maintains a single work item per hire/task and makes partial external-service failures safe to retry without losing completed work.
- **Alternative considered:** Create replacement tickets on resume. That complicates recovery and risks duplicate work in the connected team system.

## 2026-11-24 — Use an SVG dependency canvas for hire-level exploration

- **Decision:** Render the hire dependency map and Gantt in native SVG with keyboard task selection, internal scrolling, zoom controls, and a shared task inspector.
- **Why:** The repository has no graph-layout dependency, and the onboarding graph is small enough for a deterministic rank layout that can be inspected and tested without adding a new package.
- **Alternative considered:** Add React Flow and dagre as new dependencies. The native canvas covers the current hire workflow without changing dependency resolution; the template editor still needs an editable DAG canvas.

## 2026-11-24 — Persist joining dates while retaining deterministic demo-day math

- **Decision:** Persist a hire's organization-local joining date, derive projected-ready dates from the configured timezone, weekdays, and holiday list, and keep the integer `start_day` as the simulation index used by CPM and the demo clock. The hire API accepts a real `start_date`; the legacy `start_day` input remains supported.
- **Why:** HR and new hires need an actual date, while the established deterministic demo, monitor, and CPM workflows depend on an indexed clock. The mapping now uses one server-side business calendar and accounts for the current demo-clock date.
- **Alternative considered:** Replace every orchestration and CPM day counter with calendar date arithmetic. That would blur simulator offsets with wall-clock time and touch the already-tested monitor/experiment APIs; the new date field provides persistence and calendar-correct presentation without that ambiguity.

## 2026-11-24 — Edit onboarding dependencies directly on a responsive graph

- **Decision:** Lay out template tasks in dependency-depth columns, let users connect tasks by selecting a prerequisite then a downstream task, and keep a task inspector for details, approval, fallback and checkbox-based prerequisite editing. Validate cycles, unknown keys and duplicate keys live before publishing.
- **Why:** HR/Admin can understand and adjust cross-team sequencing visually while keyboard access and mobile scrolling remain practical. Invalid plans are easier to fix before they become the template for new hires.
- **Alternative considered:** Add React Flow and dagre to enable draggable edge handles. The current plan size is modest and the repository does not have those packages, so a native SVG canvas keeps the local-first dependency footprint small and gives the editor predictable accessible controls.

## 2026-11-24 — Keep the hire collection shape while adding server pagination

- **Decision:** Apply hire search, status, sort, and page parameters in the API; keep the existing JSON array response and add total/page metadata as response headers. The HR portfolio reads those headers for its pager and still shares the array contract with manager dashboards.
- **Why:** The HR page needs server-side behavior once hires outgrow one client payload, while current role views and API callers already expect `/hires` to return an array.
- **Alternative considered:** Replace the response with an `{items, total, page}` object. That would require changing every existing role consumer and generated contract for a UI-only pagination improvement.

## 2026-11-24 — Separate liveness from database readiness

- **Decision:** Keep `/health` as a process liveness response and add `/ready` aliases that execute `SELECT 1` against the configured database, returning 503 if the check fails.
- **Why:** A running web process should not be advertised as ready to serve onboarding requests when its primary datastore is unavailable.
- **Alternative considered:** Make `/health` perform the database query. That would turn a basic process check into a dependency check and could cause service managers to restart a healthy process during a transient database outage.

## 2026-11-24 — Rate-limit login by pair, account, and client IP

- **Decision:** Keep the 20-per-15-minute IP/email-pair bucket, add a 60-per-account bucket and a 100-per-IP bucket, and retain the five-failure account lockout. Guard the rolling windows with a thread lock and periodically prune expired entries.
- **Why:** Pair-only throttling lets a client evade the limit by changing email addresses; account-only throttling lets a client evade it by rotating source IPs. Separate scopes close both gaps for the single-process local app.
- **Alternative considered:** Add a distributed rate-limit store or middleware for every route. That adds infrastructure beyond the local-first MVP; this increment protects authentication and recovery endpoints in the single-process local app.

## 2026-11-24 — Bound public recovery endpoints by client IP

- **Decision:** Limit password recovery requests to 10 per client IP per 15 minutes, and reset-token submission and invite acceptance to 30 each per client IP per 15 minutes. Keep independent endpoint buckets and a generic 429 response.
- **Why:** Recovery links trigger costly password hashing and mail-outbox writes, while reset and invitation endpoints accept anonymous tokens. Per-endpoint IP limits slow abuse without adding infrastructure or changing generic account-enumeration behavior.
- **Alternative considered:** Use one shared limit across all anonymous endpoints. Independent buckets prevent password recovery traffic from consuming the reset or invite allowance; a distributed store can be added if the app later runs multiple workers.

## 2026-11-25 — Keep HR portfolio views bookmarkable and local-first

- **Decision:** Store search, status, sort and page in the URL; persist saved views in browser local storage; build CSV downloads from all API pages matching the active search/status filters and escape spreadsheet formula prefixes.
- **Why:** HR can share or bookmark a portfolio state and reuse personal views without adding server-side preference storage. The export remains complete beyond the current page and inherits the API's authorization filters.
- **Alternative considered:** Persist named views in the backend and add a dedicated export endpoint. Browser-local saved views avoid another data model/migration; pagination over the already-authorized API preserves the no-new-endpoint local-first design.

## 2026-11-25 — Scope bulk lifecycle actions to the visible hire page

- **Decision:** Let HR select hires on the current page and bulk pause or resume eligible selections through the existing per-hire lifecycle endpoints. Clear selection when the query/page changes and report partial success counts.
- **Why:** Each lifecycle route already reconciles tickets and writes an audit event. Keeping one request per hire preserves those safeguards while making multi-hire follow-up faster; page-local selection avoids accidentally acting on unseen records.
- **Alternative considered:** Add a batch endpoint and select all filtered hires across pages. A new transaction boundary would be misleading because ITSM reconciliation can partially fail, so this UI reports independent outcomes using the existing single-hire behavior.

## 2026-11-25 — Edit hire details without mutating the generated role plan

- **Decision:** Add an audited HR/Admin patch for name, department, manager and joining date. Validate managers as active MANAGER users; validate new joining dates against the organization calendar; recompute CPM and projected readiness immediately. Keep role changes unavailable after plan creation.
- **Why:** Each hire's role identifies the task snapshot and its dispatched tickets. Editing the role alone would leave the visible role and coordinated work out of sync; replacing a live plan needs a separate safe migration workflow.
- **Alternative considered:** Regenerate tasks when the role changes. Existing approvals, completed tasks, and external tickets would need reconciliation, so the edit flow protects the current plan while enabling operational detail corrections and date changes.

## 2026-11-25 — Allow role changes only before onboarding work starts

- **Decision:** Supersede the role-lock portion of the hire edit decision above. HR/Admin may replace a role's task plan only while the hire is active and every existing task is pending, ticket-free, and approval-free. Reject the change once a ticket, approval, or completed work exists. Audit the old/new role and rebuild tasks from the active validated template or planner fallback.
- **Why:** Before dispatch, the generated tasks have not escaped into team systems and can be replaced coherently. Once work starts, deleting or remapping tickets and approvals would risk losing operational history.
- **Alternative considered:** Allow unrestricted plan regeneration, or keep roles permanently immutable. Unrestricted regeneration is unsafe after dispatch; permanent immutability blocks valid corrections before anyone starts work.

## 2026-11-25 — Support direct dependency editing with graph handles

- **Decision:** Keep the deterministic SVG template canvas and add draggable source/target ports for creating prerequisite edges. Retain click-to-connect and keyboard selection alongside dragging; keep edge-click removal and task inspector controls.
- **Why:** Dragging directly communicates dependency direction and makes edits faster to discover, while the existing alternatives preserve keyboard access and precise checkbox editing. No graph package is needed for the current template size.
- **Alternative considered:** Replace the current layout with a graph library. The existing SVG layout already supports small DAGs and avoids a new dependency; the current template sizes do not yet justify graph-library overhead.

## 2026-11-25 — Keep a reproducible local API load baseline

- **Decision:** Provide a small authenticated read-only profile for the hire portfolio and metrics endpoints using the existing HTTPX dependency. Report throughput, status counts, and latency percentiles; keep request and concurrency bounds explicit.
- **Why:** A repeatable baseline makes latency and failure regressions visible during local development without adding a hosted service or another dependency. Demo auth lets the profile exercise normal API authorization.
- **Alternative considered:** Add a production load-testing service or impose an absolute latency gate from one developer machine. Hosted infrastructure is outside the local-first scope, and a machine-specific threshold would be misleading; use the baseline as a measurement, not an SLO.

## 2026-11-25 — Position OnboardIQ without claiming exclusive dependency modeling

- **Decision:** Describe Asana and monday.com as supporting dependencies, Workday and ServiceNow as configurable employee-workflow platforms, and SAP SuccessFactors’ onboarding task agent as a close comparator. Position OnboardIQ around the combination it implements in this prototype: live remaining-work CPM, targeted stall recovery, and an inspectable MCP boundary. Link official vendor material and ask reviewers to verify plan/feature availability before external use.
- **Why:** Competitor products already cover meaningful parts of this problem; a “nobody models dependencies” claim would be inaccurate. SAP’s current task agent is especially relevant and its documented availability has an Early Adopter Care qualification.
- **Alternative considered:** Reuse the earlier broad gap statements (“static checklists,” “no cross-team control,” “vendor-locked”). Those simplify the pitch but do not describe the capability overlap or customer-specific configuration accurately.
