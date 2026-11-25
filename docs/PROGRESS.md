# Implementation progress

This file records verified state against the phases in the product brief. A gate is **passed** only after the required behavior has been exercised successfully.

## P0 — Foundation and `run.py`

### Done

- Existing FastAPI/SQLModel prototype and React/Vite app retained.
- Added a cross-platform `run.py` launcher with Python/Node version checks, virtual environment creation, install caching, environment initialization, demo seed handling, health polling, and cleanup.
- Added `--reset`, `--test`, `--no-browser`, and `--prod` command-line options to the launcher.
- Updated the frontend to call the API through the Vite `/api` proxy.
- Added responsive app navigation, role demo switch, theme persistence, command palette, keyboard shortcuts, notification entry point, and floating demo controls.
- Updated the dependency pins to a resolvable set matching `google-genai==3.6.1`.
- Backend test suite passed: **53 passed in 1.71s** with the updated requirements.
- Frontend production build passed after the shell and Tailwind v4 import changes.
- The live shell rendered the existing hire data through the `/api` same-origin proxy, and responsive sidebar/command controls were inspected in the browser.
- Alembic initial schema migration, SQLite WAL/foreign-key pragmas, and optional FastAPI static serving for `--prod` are in place.
- `python run.py --no-browser` started both services; direct `/health` returned `ok`, and `/api/health` through Vite returned `ok`.
- `python run.py --prod --no-browser` served the frontend document (HTTP 200) and `/health` (status `ok`) from port 8000.
- The final startup run showed prefixed `[api]` and `[web]` logs and printed the app/API/health URLs.

### Mocked

- Role switching is client-side only and grants no security boundary.
- The top-bar live indicator and workspace health card are presentation only; no SSE connection exists yet.
- The demo panel still exposes the prototype simulator controls.
- Product data pages are the original prototype; hires, approvals, tasks, and experiment results come from the existing API.

### Status

- Authentication/RBAC, the first-admin flow, full local mail outbox, and the expanded route-level product pages are not implemented yet.
- The full 390/768/1440 light/dark Playwright screenshot matrix and accessibility audit have not been run.
- P0 verification required approved local execution because the restricted sandbox stalled TestClient startup; outside the sandbox the 53 tests passed.

### Gate and commit

- **P0 gate: passed.** Development startup and the Vite API proxy were verified; `--prod` static serving was also checked.
- **Tests:** 53 backend tests passed; TypeScript/Vite production build passed (the bundle-size advisory remains).
- Conventional P0 commit follows this progress update.

## P1 — Auth and RBAC

### Done

- Added Argon2id password hashing, a 10-character minimum, generic login errors, per-account lockout, and an in-process IP/account attempt limiter.
- Added short-lived access JWTs in memory on the client and hashed, rotating refresh tokens in httpOnly SameSite=Lax cookies. Refresh-token reuse revokes its token family; cookie endpoints use double-submit CSRF and an Origin allowlist.
- Added logout, logout-all, password change, generic forgot-password, single-use 30-minute reset tokens, invitation acceptance, and `must_change_password` for invited accounts.
- Added admin-only user list, invite, role/team update, and deactivation endpoints. First non-demo admin creation is available through `python -m app.cli create-admin`.
- Added auth security audit records and a persistent local mail outbox; demo administrators can inspect it at `/api/dev/mail`.
- Added role guards for hire, approval, ticket, simulation, and user-management routes. Manager hire reads are scoped to assigned hires; IT staff ticket access is restricted to their team.
- Added a split-screen sign-in experience, one-click demo account fill, recovery/reset/invitation screens, and role-aware application navigation.
- Alembic migration `0003_auth_lifecycle` adds one-time tokens, mail outbox, and security audit tables. API startup no longer mutates schema outside Alembic.
- P1 gate run: `python run.py --test` passed **85 backend tests** and the TypeScript/Vite production build. Tests include login/me, CSRF, refresh rotation/reuse, lockout, reset single-use, invite acceptance, logout, password change, admin-only user operations, role matrices, and manager data isolation.

### Mocked

- Recovery and invitation messages are written to the local database outbox; SMTP is not configured.
- The session and recovery screens were typechecked/built; no browser-driven login or full visual screenshot matrix has been run yet.

### Known gaps

- Rate limiting uses process memory and is intended for the single-process local app; multi-worker deployments need a shared limiter.
- Security headers, comprehensive route-by-route RBAC matrices, password-change UI, and user administration UI remain for later hardening/product phases.
- The bundle currently exceeds Vite's 500 kB advisory threshold; build still succeeds.

### Gate and commit

- **P1 gate: passed.** Auth/session flows and role allow/deny cases pass in the backend suite; the frontend login and recovery flows compile into the production bundle.
- **Tests:** 85 backend tests passed; TypeScript/Vite production build passed.
- Conventional P1 commit follows this progress update.

## P2 — Domain core

### Done

- Added a timezone-aware UTC clock and business calendar with weekend skipping, holiday support, signed business-day counts, join-day deadline calculation, and business-day demo offset.
- Strengthened plan validation: task keys and titles must be nonblank, keys unique, durations positive, teams allowed, dependencies present, and the graph acyclic.
- Strengthened CPM to reject duplicate/unknown dependencies and preserve negative or zero deadlines so expired schedules stay at risk.
- Added a pure what-if calculation for 0–10 business-day delay to an open task; it returns baseline/projected ready day, delta, and the recomputed critical path without changing stored tasks.
- Added role-based plan preview and hire what-if endpoints with manager ownership checks.
- Added tests for calendar boundaries/holidays, timezone-aware storage, plan DAG validation, deadline risk, CPM dependencies, what-if outputs, and API responses.
- P2 gate run: `python run.py --test` passed **101 backend tests** and the TypeScript/Vite production build.

### Mocked

- Role templates are validated code-defined plans; editable, versioned template records and the visual template editor remain for P8.
- Hire schedules still use the prototype's integer simulated-day fields. The new date-based clock is available as a pure service but is not yet wired into persisted hire dates or every orchestrator decision.

### Known gaps

- Holiday lists, organization timezone settings, and demo clock offset are not yet persisted/admin-configurable.
- The hire what-if API reports relative simulated day numbers; it does not yet return an ISO calendar date.
- Frontend plan preview/what-if interactions are scheduled for P7/P8.

### Gate and commit

- **P2 gate: passed.** Full backend suite and frontend build pass with the new planner/CPM/calendar coverage.
- **Tests:** 101 backend tests passed; TypeScript/Vite production build passed.
- Conventional P2 commit follows this progress update.

## Next phase — P3 Integration

## P3 — Integration

### Done

- Added the official MCP Python SDK 1.x FastMCP servers for mock ITSM and HRIS, each with its own persistent SQLite database.
- Added one long-lived stdio client session per service, guarded for concurrent calls and closed at process exit. Broken sessions return `service_unavailable` and are recreated on the next call.
- Routed ticket creation, reads/status changes, cancellation, HRIS hire registration, and onboarding status updates through MCP tools. The app ticket table is now a read-model mirror of tool results.
- Added MCP-backed ITSM offline controls. Failed ticket creation is queued in the outbox; retry uses the same idempotency key, including the case where the service accepted a ticket but the response was lost.
- Demo reset clears mock ITSM and HRIS stores so IDs can be reused without stale tickets.
- Added actual stdio round-trip, duplicate idempotency, offline response, outbox recovery, and no-duplicate recovery tests.
- Updated Uvicorn to a compatible range after the existing 0.30.6 pin conflicted with the MCP SDK.
- P3 gate run: `python run.py --test` passed **103 backend tests** and the TypeScript/Vite production build.

### Mocked

- ITSM and HRIS are local SQLite-backed services, not vendor integrations.
- Unit tests use the same tool implementations in-process for isolation; dedicated tests exercise actual stdio subprocess sessions.

### Known gaps

- MCP process health is detected when a tool call fails; there is no scheduled health dashboard or automatic outbox retry scheduler until P4.
- HRIS update failures do not yet have a durable retry queue.
- The current IT console still changes status through its existing complete/stall actions; the broader ticket workflow and comments arrive in P7.

### Gate and commit

- **P3 gate: passed.** MCP stdio round trip, service outage, idempotent duplicate prevention, and outbox recovery tests pass.
- **Tests:** 103 backend tests passed; TypeScript/Vite production build passed.
- Conventional P3 commit follows this progress update.

## Next phase — P4 Orchestrator

## P4 — Orchestrator

### Done

- Added an APScheduler interval job that starts/stops with FastAPI and calls the same monitor as manual/demo triggers.
- Added migration `0004_scheduler_lease` and a durable 60-second DB lease shared by scheduled and manual monitor cycles. A cycle now commits its DB state once before releasing the lease; failed cycles roll back the local transaction.
- Made ticket creation, outbox drain, critical-path updates, escalations, notifications, readiness and audit records safe to replay after a process crash through stable MCP idempotency keys.
- Fixed stall fallback handling: the existing ITSM ticket is updated to the loaner title/duration and retains its ticket ID, so recovery does not create duplicate work.
- Kept escalation idempotent per task and scoped intervention to critical or near-critical tasks. Normal stalled items outside that band are only marked `watch`.
- Audit events now identify agent actions as `agent:<name>` and human approvals/completions as `user:<id>`. Manager approvals are limited to tasks for their assigned hires.
- Added tests for exclusive lease ownership, critical-path laptop rescue without duplicate ticket, one escalation per task, and outbox recovery from a separate backend subprocess.
- P4 gate run: `python run.py --test` passed **106 backend tests** and the TypeScript/Vite production build.

### Mocked

- The scheduler is a single in-process APScheduler instance; the lease coordinates it with manual triggers and any additional local app processes.
- HRIS updates are best-effort MCP calls; unlike ITSM ticket creation, they do not yet have their own durable retry outbox.

### Known gaps

- The 60-second lease is not renewed during a long cycle; current local mock operations are short. A production integration with slow external calls should renew the lease.
- Human ticket workflow still has limited actions (complete/stall) and no comments/assignee management.
- Pause/cancel hire lifecycle and manager approval undo are not implemented yet.

### Gate and commit

- **P4 gate: passed.** Stall rescue and subprocess restart recovery pass with the full suite.
- **Tests:** 106 backend tests passed; TypeScript/Vite production build passed.
- Conventional P4 commit follows this progress update.

## Next phase — P5 Realtime and AI

## P5 — Realtime, notifications, and optional AI

### Done

- Added 60-second, single-use SSE tickets. Ticket creation requires a valid access JWT; only the hashed ticket is stored; the event stream consumes it once and returns a role/ownership-filtered notification stream.
- Added role-aware notification read-all and corrected notification filtering for MANAGER, IT/FACILITIES, NEW_HIRE, HR, and ADMIN.
- Added optional Pydantic-validated Gemini task suggestions, risk explanations, and escalation drafts. Hire creation and plan preview use the validated optional suggestions; no key or invalid/error response falls back to templates and deterministic copy.
- Kept all scheduling, approval, permissions, retries, dispatch, and stall/reschedule decisions deterministic.
- Added SSE ticket authorization, event delivery, single-use replay rejection, role filtering, notification read-all, and no-key fallback tests.
- P5 gate run: `python run.py --test` passed **111 backend tests** and the TypeScript/Vite production build.

### Mocked

- Email remains the local `MailOutbox`; SMTP and Slack/Teams webhooks are not configured.
- EventSource wiring and browser reconnect/polling fallback will be added with the P6 frontend foundation.
- Gemini calls were not made in test runs; the no-key/template path is covered. Live-key quota and model behavior have not been exercised.

### Known gaps

- There is no durable event replay/history API beyond the notification table or SSE event retention policy.
- The browser does not yet open the SSE stream, show reconnect state, or fall back to polling.
- The email outbox is inspectable via the backend demo endpoint; the polished `/app/dev/mail` page is planned for P8.

### Gate and commit

- **P5 gate: passed.** SSE tickets are authenticated, short-lived and single use; no-key LLM paths pass.
- **Tests:** 111 backend tests passed; TypeScript/Vite production build passed.
- Conventional P5 commit follows this progress update.

## Next phase — P6 Frontend foundation

## P6 — Frontend foundation

### Done

- Enabled TypeScript strict mode and fixed the type mismatches it exposed.
- Added `scripts/generate_api_types.py` and the `npm run typegen:api` command to generate the frontend contract from FastAPI OpenAPI. The API client now uses generated schemas for auth, hire, and task contracts.
- Added route-level lazy loading with Suspense fallbacks for dashboard pages, account recovery, and demo controls.
- Added authenticated SSE ticket acquisition, a native EventSource client, exponential reconnect, and 15-second query invalidation fallback. The stream route is authorized by its single-use ticket; ticket creation still requires JWT authentication.
- Added persisted system/light/dark themes, live connection status, keyboard shortcuts, loading shimmer, and reduced-motion support.
- Ran the production build and signed in through the local UI. Visually inspected the login and admin shell at the current desktop viewport; confirmed the connection indicator reaches Live.
- Fixed the P5 SSE integration issue found during visual review: app-wide bearer dependencies had been applied to the EventSource route, which cannot send the Authorization header.

### Mocked

- The local app continues to use demo seed data and local SQLite-backed MCP systems. No external HRIS/ITSM vendor service is connected.
- Authenticated notifications are refetched through React Query after SSE updates; a full notification popover is part of P7.

### Known gaps

- The responsive screenshot sweep at 390, 768, and 1440 px in both themes is still pending with the P7 Playwright visual QA setup; the P6 manual review covered the login and admin shell at desktop size.
- The event hook invalidates queries for each notification and does not yet display the planned live row flash/action toast.
- Browser-based visual review required an escalated local loopback server. In-sandbox Python imports that initialize the MCP asyncio client cannot create a Windows socketpair; the test gate was therefore run outside the sandbox.

### Gate and commit

- **P6 gate: passed.** Strict TypeScript/Vite build passes; local login succeeds; SSE connection visibly reaches Live; login and admin shell visual review completed.
- **Tests:** `python run.py --test` passed **111 backend tests** and the strict TypeScript/Vite production build. Pytest and Starlette emitted deprecation warnings only.
- Conventional P6 commit follows this progress update.

## P7 — Role portals

### Done

- Added role-specific HR hire creation, manager readiness/approval inbox, team ticket queue, and the privacy-scoped new-hire timeline and issue report.
- Added ticket start, block, stall, and comment workflows, recent approval undo, scoped manager listing, mobile table behavior, notification controls, and explicit mobile sign-out labels.
- Added responsive screenshots for every role route at 390, 768, and 1440 px in light and dark themes; the final matrix waits for seeded route data and rejects horizontal page overflow.
- Browser workflow suite: **8/8 passed**, including role login, HR hire wizard, manager/IT/new-hire actions, the chained recovery-to-READY acceptance, and axe audits.
- Manually inspected populated mobile, tablet, desktop, and dark-mode captures; corrected a 674 px mobile table overflow, a tablet topbar overflow, and footer overlap.

### Mocked

- ITSM and HRIS remain local MCP mock services; humans still perform the actual work.
- Live SSE invalidates client queries, while full row-flash/action toasts and visual coachmarks remain simplified.

### Known gaps

- Live SSE refreshes query data; richer row-level action toasts and coachmark polish remain simplified.
- No real vendor ITSM/HRIS or outbound email service is connected.

### Gate and commit

- **P7 gate: passed.** Role-specific browser flows, axe smoke checks, and responsive visual review passed.
- **Tests:** 124 backend tests passed in `python run.py --test`; Playwright 8/8; axe found no serious/critical violations; the 162-image screenshot matrix passed.
- P7 role portals and their shared route wiring are included in implementation commit `a63f3f5`.

## P8 — Insights, administration, and guided demo

### Done

- Added persistent role templates with DAG validation/versioning, people and invite controls, global guardrails, audit search/CSV, development mail view, demo clock, and immediate scheduler interval updates.
- Added saved experiment runs, operational insight metrics, hire what-if controls, demo auto-worker, and guided demo steps.
- Added role-neutral profile editing, password change, and user-scoped notification preferences. Disabling in-app notifications suppresses API and SSE delivery.
- Added migrations for ticket comments, settings/templates/experiments, and readiness/approval timestamps; fixed fresh-migration guards and verified clean isolated SQLite startup.

### Mocked

- The experiment is a deterministic illustrative simulation, not production outcome data.
- Email preferences are saved locally; real email delivery is not configured. The development outbox is local-only.
- Demo auto-worker changes mock ticket state for walkthroughs; it is not a real workforce agent.

### Known gaps

- No production vendor adapters or SMTP delivery are configured; the experiment remains illustrative simulation data.

### Gate and commit

- **P8 gate: passed.** The required end-to-end demo flow and supporting outage/restart recovery checks passed.
- **Tests:** Backend suite: 124 passed; Playwright suite: 8/8 passed; responsive screenshot matrix and axe audit passed.
- P8 administration and guided-demo support landed with the shared portal implementation in `a63f3f5`; the end-to-end browser gate is in `fce2068`.

## P9 — Hardening

### Done

- Added an axe-core browser audit to Playwright and corrected contrast, label, keyboard scroll region, search naming, and loading-live-region findings.
- Added scoped Ruff checks and a core backend coverage gate; final planner/clock/CPM/experiment coverage is **90.59%** (124 passed, above the 80% floor).
- Added per-run isolated browser QA SQLite and MCP stores, avoiding changes to the main demo database.

### Known gaps

- GNU Make is unavailable in this Windows environment, so every `verify` component was run separately: backend tests, coverage, Ruff, strict TypeScript/Vite build, Playwright/axe, and screenshots. Production-like load/performance profiling was not run. Mypy still reports third-party SQLModel typing errors and is not part of the passing gate.

### Gate and commit

- **P9 gate: passed.** All constituent verification gates passed individually; no serious/critical axe findings remain.
- **Lint/build:** Ruff passed; strict TypeScript and Vite production build passed.
- **Commit:** `fce2068 test: harden onboarding workflows and visual QA`.

## P10 — Docs and release

### Done

- Updated README quickstart, demo-account details, commands, and populated screenshot examples; P10 originally captured 162 images before the hire schedule/graph views were added.
- Standardized the review brief to the requested six sections and recorded P7/P8 implementation decisions.
- Rewrote outdated prototype sections to describe current role workspaces, generated API contracts, test tools, and local-service limitations.

### Status

- P10 clean-copy startup has now been verified from a fresh `git archive HEAD` extraction using only Python and Node/npm prerequisites; the temporary environment was removed after the run.

### Gate and commit

- A fresh archive extraction completed `python run.py` and `python run.py --no-browser`; first run installed backend/frontend dependencies, applied migrations and seeded the Priya scenario. The default command printed all URLs and demo credentials and launched the app.
- Clean-copy smoke checks returned 200 for `/health`, `/api/v1/health` through the Vite proxy, and the frontend shell; seeded admin login and authenticated template listing also passed through the proxy.
- `python run.py --test` passed 130 backend tests and the strict TypeScript/Vite production build in the main workspace; no external production services are needed for the demo.
- **P10 gate: passed** for clean-copy first start, seeded demo login, frontend/API proxy, docs, and the 198-image responsive visual matrix.
- Release risks and production gaps are called out in `docs/SECURITY.md`: mock external services, local mail delivery, and absence of production load/security certification.

## P11 — Product brief audit follow-up

### Done

- Added a live remaining-work schedule with critical path, Day 1 marker, today marker, zoom, task inspection, and keyboard-accessible scrolling.
- Added a selectable dependency graph with upstream/downstream highlighting, status/critical/stalled styling, zoom, fit view, and task details.
- Replaced the comma-separated template row editor with a responsive task dependency canvas, keyboard-selectable nodes, click-to-connect mode, removable prerequisite arrows, a live task inspector, dependency checkboxes, manager approval and recovery fallback settings.
- Added live key/dependency/cycle validation that disables publishing until the plan is valid; small-screen graph panning stays inside the canvas without widening the page.
- Added server-side hire search, status filtering, stable sorting and bounded pagination with total/page response headers. HR’s portfolio query state drives the React Query cache key; summary metrics are server-wide, not page-local.
- Synced HR portfolio search, status, sort and page state into the URL; saved named-by-filter views in local storage; added CSV export that fetches every page matching the active search and status, with spreadsheet-formula escaping.
- Added page-local hire selection with bulk pause/resume actions through the existing audited API routes; mixed outcomes report successful and failed counts, and the selection clears when the portfolio query changes.
- Added an HR/Admin hire detail editor for name, department, manager and joining date. The API enforces active-manager selection and business-day/future joining dates, immediately recalculates CPM and projected readiness, and audits each update.
- Rejected whitespace-only name/department edits before trimming so required hire labels cannot become empty.
- Updated the API schema generator so Pydantic models that forbid extra fields do not produce an impossible `never` index signature in TypeScript.
- Added `/ready` aliases that probe the database connection and return 503 when the database is unavailable; `/health` remains a liveness check.
- Added independent rolling 15-minute login limits for each IP/email pair, each account, and each client IP, alongside the existing five-failure account lockout.
- Added separate 15-minute per-IP limits for password recovery (10), reset-token submissions (30), and invitation acceptance (30); recovery responses remain generic.
- Added HR/Admin pause, resume, and typed-confirmation cancel actions. Pause/cancel reconcile mock ITSM tickets, preserve completed work, audit the action, and let partial failures be retried.
- Suppressed stale critical-path actions and what-if task choices for paused/cancelled tasks; their overview now explains the closed state.
- Added `/api/v1` aliases, Problem Details responses, request IDs, baseline security headers, and frontend routing through the versioned API.
- Persisted real joining dates with an Alembic backfill, accepted date-based hire creation, and calculated current/earliest/default joining dates from the organization timezone and configurable holiday calendar. The internal simulation-day index remains for deterministic CPM/demo behavior.
- HR hire creation and the new-hire portal now show joining/projected-ready dates. Admin can edit the ISO-date holiday list; invalid weekends and past dates are rejected by the API.
- Added API and UI coverage for task schedule positions and ticket-aware pause/resume/cancel; corrected generic-auth-error checks to ignore per-request IDs.
- Refreshed the screenshot matrix to **198 images**, including graph/schedule tabs and the template canvas at all required role/viewport/theme combinations. Visual inspection covered the HR portfolio at 390px light and 1440px dark, the template canvas at 390px light and 1440px dark, mobile graph/schedule, and desktop light/dark hire graph/schedule captures.

### Verification

- Template canvas interaction test passed: live dependency changes, cycle warning/publish lockout, recovery, and fallback editing.
- Hire API search/sort/status/pagination tests passed; HR browser test confirms server-filtered search, result counts and status filter state.
- Readiness tests passed at `/ready`, `/api/ready`, and `/api/v1/ready`.
- Login limiter tests passed for independent IP-wide and account-wide buckets; Ruff passed for the backend and migrations.
- The **198-image** role/viewport/theme matrix passed after fixing a 390px page overflow; the graph now scrolls inside its canvas while settings remain within the viewport.
- Inspected final template screenshots at 390px light and 1440px dark. The final full matrix includes the canvas at each required admin and HR viewport/theme combination.

- Full backend suite passed: **135 tests**; this includes date/calendar mapping, hire detail edits and forecast recalculation, active-ticket pause/resume/cancel, HR/Admin permission checks, API versioning, Problem Details, hire list query/pagination behavior, database readiness aliases, login rate buckets, and public recovery rate limits.
- `python run.py --test` passed the backend suite and strict TypeScript/Vite production build; Ruff passed (`E4,E7,E9,F`).
- Playwright passed **11/11**, including hire search/status filters, saved-view restore and CSV download, bulk pause/resume, editable hire details and joining-date changes, template dependency edits/cycle recovery, the Priya recovery-to-READY scenario, and the serious/critical axe audit.
- Final visual matrix passed and was regenerated: **198 screenshots**; representative mobile/desktop template and HR portfolio captures plus hire graph/schedule views were opened and inspected.

### Known gaps still open against the original brief

- CPM and monitor internals still use a simulation-relative integer day index; real dates are persisted and mapped to that index at the API boundary.
- Template dependencies support draggable edge handles, click-to-connect, keyboard task selection, and prerequisite controls; templates remain below the 40-task API limit.
- Role changes are allowed only before work starts: all tasks must remain pending with no tickets or approvals. After any work begins, the role stays locked; name, department, manager and joining date remain audited edits.
- Other unauthenticated endpoints remain without rate limits; login and recovery limits are in-memory per process. Public UUID identifiers now cover all persisted resource IDs returned by the product APIs, including hires, tasks, notifications, users, tickets, comments, audit entries, templates, experiments, and development mail. Code-defined template fallbacks intentionally have no persisted ID; request-wide transaction semantics remain open hardening work.
- Core backend coverage is **90.6%** across CPM, planner, clock, and experiment modules. A repeatable local authenticated API load profile now exists; production infrastructure/SLO profiling and dedicated Vitest component tests have not been added. The GNU Make target mirror has not been independently exercised because GNU Make is unavailable on this Windows machine.
- The app uses local/mock ITSM and HRIS, local development mail, and an in-process deterministic layout/orchestrator; no LangGraph adapter or production vendor integration is claimed.

### Gate

- **P11 audit follow-up gate: passed** for the shipped visualization, lifecycle, API versioning, template editor, and hardening changes listed above. The P10 clean-copy gate now passes; the remaining product gaps in this section mean the overall brief is still in progress.
- **Implementation commits:** `2509f0f feat: persist joining dates with business calendar`; `42243e0 feat: add interactive onboarding template canvas`; `07a90ef feat: add server-side hire portfolio queries`; `9d454ac feat: expose database readiness checks`; `5532a6b fix: throttle login by account and client ip`.

### Public authentication throttling follow-up — 2026-11-24

- `python run.py --test` passed **134 backend tests** and the strict TypeScript/Vite production build; Ruff passed on the changed auth module and tests.
- No frontend behavior changed; the previously verified 10/10 Playwright suite and 198-image screenshot matrix remain applicable.
- **Gate: passed.** This increment was committed after verification.

### HR portfolio workflow follow-up — 2026-11-25

- Portfolio filters and paging now live in query parameters so searches can be bookmarked and shared. HR can save/remove commonly used views, restore them later, and export all filtered rows to CSV.
- Export quotes CSV cells and neutralizes leading spreadsheet formula characters. Mobile toolbar controls wrap into a three-column row; hire date and demo-day notes now have clear spacing.
- Verification: strict TypeScript/Vite production build passed; Playwright passed **10/10**, including URL state, saved-view restore and CSV download; responsive screenshot matrix passed **198 captures** with no page overflow. Inspected HR overview at 390px light and 1440px dark.
- **Gate: passed.** Bulk actions are complete for the current page; role changes and task-plan regeneration remain open. This increment is committed after verification.

### Hire detail editing — 2026-11-25

- Added audited `PATCH /hires/{id}` plus an HR/Admin edit dialog for the name, department, manager and joining date. Joining-date changes must be future business days and are disabled for paused, ready or cancelled plans; active plans recalculate CPM and projected readiness immediately.
- Kept role changes locked because each hire's role is the source of its already-generated task snapshot; changing it without replacing tickets/tasks would misrepresent the plan.
- Corrected generated OpenAPI typing for closed Pydantic request models (`additionalProperties: false`).
- Verification: `python run.py --test` passed **135 backend tests** and the production build; Ruff passed; Playwright passed **11/11** including edit/save and date movement; the refreshed **198-capture** screenshot matrix passed, and the hire detail was inspected at 390px light and 1440px dark. Whitespace-only edit validation also passed its API regression test.
- **Gate: passed.** Role changes and task-plan regeneration remain outside this safe edit flow. This increment is committed after verification.

### HR bulk portfolio actions — 2026-11-25

- Added checkboxes to select hires on the current page, with page-wide select/clear and selection reset when filters or paging change. Eligible hires can be paused or resumed in bulk; terminal and ready hires are excluded from pause actions.
- Actions use the existing per-hire audited lifecycle routes. Each request can succeed or fail independently, and the completion notice reports both counts.
- Verification: frontend build passed; Playwright passed **11/11**, including a browser pause/resume round trip; the refreshed **198-capture** screenshot matrix passed with no overflow, and HR portfolio captures at 390px light and 1440px dark were inspected.
- **Gate: passed.** A full hire edit flow remains open. This increment is committed after verification.

### Safe role change and plan regeneration — 2026-11-25

- HR/Admin can change a hire's role while every task is still pending and no ticket or approval exists. The API rebuilds the plan from that role's active template (with the existing validated fallback), updates the mock HRIS record, and records an audit event. It rejects role changes on paused/terminal plans or after work starts.
- The hire editor enables the role selector only when the loaded task state meets those rules and explains why it becomes locked. The browser flow now changes the role, confirms the new role-specific nine-task plan, then exercises pause/resume/cancel.
- Verification: `python run.py --test` passed **135 backend tests** plus the strict TypeScript/Vite production build; Ruff passed; Playwright passed **11/11**, including the HR create/edit flow with role-specific plan replacement. The 198-image matrix was last run immediately before this UI change.
- **Gate: passed for this increment.** The feature remains in progress against the original brief; the open hardening, CPM, template-handle, test-framework, performance, and production-integration gaps above remain.

### Draggable template dependencies — 2026-11-25

- Added visible source/target ports to the admin task canvas. Dragging from a task's right handle to another task's left handle previews and creates a prerequisite edge; existing click-to-connect and keyboard selection remain available. Invalid graph structures continue to block publish.
- Verification: strict TypeScript/Vite build passed; Playwright passed **11/11**, including a drag gesture that verifies the dependency in the task inspector; responsive screenshot matrix passed **198 captures** with no overflow. Inspected the 390px light and 1440px dark template canvases.
- **Gate: passed for this increment.** The 40-task cap and remaining hardening, CPM, load-test, test-framework, and production-integration work remain open against the original brief.

### Core coverage verification — 2026-11-25

- Ran the Makefile's exact core coverage command directly under the project virtual environment. All **135 backend tests passed**, and CPM, planner, clock, and experiment report **90.6% combined coverage** (minimum required: 80%).
- The remaining Phase 9 gaps are the dedicated frontend component-test suite and performance/load profiling. GNU Make is not installed here, so `make verify` itself remains unverified; its component commands (backend tests, core coverage, Ruff lint/build, and Playwright E2E) have been run separately across this and the preceding increments.
- **Gate: coverage threshold passed.** The overall P9 gate remains open until the remaining quality work is completed and the aggregate target is exercised in a GNU Make environment.

### Local API load profile — 2026-11-25

- Added `scripts/profile_api.py`, an authenticated concurrent read-only profile for the hire portfolio and metrics endpoints, with bounded workload options and JSON throughput/status/p50/p95/max latency output. README documents the command and clearly scopes results to the local machine.
- Ran 100 requests at concurrency 10 against the actual local app on Windows 10 / Python 3.11.4: **0 failures**, **64.79 requests/second** overall; hire portfolio p95 **309.85 ms**, metrics p95 **308.84 ms**. These are a local baseline, not production SLO evidence.
- **Gate: local profile verified.** Production-scale load testing and the frontend component-test suite remain open.

### Product review accuracy — 2026-11-25

- Replaced prototype-era claims in `docs/REVIEW.md` with a current implementation summary, exactly six required sections, explicit mock/known-gap boundaries, and official vendor-source links.
- The competitive summary acknowledges Asana and monday.com dependency features, configurable Workday/ServiceNow journeys, and SAP’s overlapping task-risk agent with its documented EAC availability qualification. It no longer implies that dependency modeling is unique to OnboardIQ.
- Verification: checked the six `##` headings, searched for stale prototype claims, and ran `git diff --check`.
- **Gate: review artifact updated and structurally verified.** Vendor editions and availability still need confirmation before external publication, as stated in the document.

### Hire API limit/offset pagination — 2026-11-25

- Added bounded `limit` and nonnegative `offset` parameters to `GET /hires`, with `X-Total-Count`, `X-Limit`, and `X-Offset` headers. Existing `page`/`page_size` clients and metadata remain supported.
- Verification: the focused search/sort/filter/pagination API regression passed for both pagination styles, their total metadata, and invalid bounds; Ruff passed.
- **Gate: passed for pagination compatibility.** API UUID identifiers and request-wide transaction boundaries remain separate hardening gaps.

### Public UUIDs for hire resources — 2026-11-25

- Added a persistent UUID to each hire with Alembic migration `0010_hire_public_uuid`; existing rows receive UUIDv4 values while internal integer foreign keys remain intact.
- Changed hire responses and detail, edit, tasks, audit, lifecycle, what-if, and explanation routes to use UUIDs. Frontend route callers and generated OpenAPI TypeScript types now match. Notification, SSE, ticket, and demo-reset hire links expose the UUID instead of the internal key.
- Verification: full `python run.py --test` passed **136 backend tests** and the strict TypeScript/Vite production build. Added regression coverage for UUID validation, old numeric-route rejection, and notification/SSE links.
- **Gate: passed for hire API identifiers.** Other API entities still use integer IDs, and request-wide transaction semantics remain open.

### Public UUIDs for task resources — 2026-11-25

- Added persistent task UUIDs through Alembic migration `0011_task_public_uuid`, backfilling existing tasks while retaining integer internal foreign keys.
- Task list responses, approval/reject/undo routes and results, ticket references, notification payloads, and SSE links now use task UUIDs. Regenerated OpenAPI TypeScript types and updated manager action typings.
- Verification: full `python run.py --test` passed **136 backend tests**, including migration, approval, notification, and SSE regressions; strict TypeScript/Vite build and configured Ruff checks passed.
- **Gate: passed for task API identifiers.** User, notification, ticket, and comment primary IDs still need public UUIDs; request-wide transaction semantics remain open.

### Public UUIDs for notifications — 2026-11-25

- Added migration `0012_notification_public_uuid` and stable UUIDs to notification list results, read actions, and the notification JSON carried by SSE. The stream's numeric `Last-Event-ID` cursor remains internal to its replay protocol.
- Notification hire/task links already use public UUIDs; the frontend notification contract and generated route types now match.
- Verification: full `python run.py --test` passed **136 backend tests** plus the production frontend build, including UUID read-action and SSE payload checks; the migration upgraded both local startup databases.
- **Gate: passed for notification API identifiers.** Ticket and comment IDs remain public-ID gaps; request-wide transaction semantics remain open.

### Public UUIDs for users — 2026-11-25

- Added migration `0013_user_public_uuid` and exposed stable UUIDs from login/current-user responses, user lists, invitations, manager choices, and admin update/deactivation routes. JWT subjects and stored foreign keys continue using internal integer keys.
- Hire create/update inputs and hire response manager references now use manager UUIDs. The HR hire wizard, hire editor, and admin user management use the generated UUID types.
- Verification: full `python run.py --test` passed **136 backend tests** plus the strict TypeScript/Vite build; tests cover UUID user IDs, rejection of legacy numeric user/hire routes, user-management updates, and manager-scoped hire access. Both local databases upgraded through migration 0013.
- **Gate: passed for user API identifiers.** Ticket/comment identifiers and request-wide transaction semantics remain open.

### UUID-aware guided demo and visual QA — 2026-11-25

- Updated the guided walkthrough to fetch the public hire list and navigate to Priya's UUID route. The first step waits for the hire data before enabling Continue, so the route cannot fall back to a stale numeric ID.
- Updated the guided-demo, recovery, accessibility, and screenshot workflows to resolve hire routes from the visible Priya row instead of assuming `/hire/1` or `/hires/1`.
- Verification: all **11/11 Playwright end-to-end tests passed** after the UUID migration. The responsive light/dark screenshot suite produced **198 captures** with no horizontal page overflow. Inspected the 390px light insights dashboard, hire graph, and admin template editor.
- **Gate: passed for UUID-aware frontend navigation and screenshot capture.** Ticket/comment identifiers and request-wide transaction semantics remain open.

### Public UUIDs for tickets and work notes — 2026-11-25

- Added Alembic migration `0014_ticket_comment_public_uuid` to backfill stable UUIDs on ticket and comment records. Existing relational keys and ITSM `ticket_id` integration references remain unchanged.
- Ticket list and work-note create/list responses now expose UUID resource IDs; frontend ticket/comment contracts use strings. Added regression assertions for canonical, stable UUIDs across comment creation and listing.
- Verification: `python run.py --test` passed **136 backend tests** and the strict TypeScript/Vite production build; Ruff passed; Playwright passed **11/11**, including ticket comment entry and the full Priya ITSM recovery scenario.
- **Gate: passed for ticket and comment API identifiers.** Other secondary API entity IDs and request-wide transaction semantics remain open.

### Public UUIDs for audit and supporting records — 2026-11-25

- Added migration `0015_secondary_resource_public_uuid` for workflow/security audit events, published templates, experiment runs, and local development mail. Fixed the new-hire issue receipt to return the notification UUID.
- Audit responses now use UUID IDs and UUID hire/user references, including the hire-specific audit endpoint. Frontend record contracts now consistently type public resource IDs as strings.
- Verification: `python run.py --test` passed **136 backend tests** and the strict TypeScript/Vite production build; Ruff passed across app, tests, and migrations; Playwright passed **11/11** including the admin audit/template screens and new-hire issue flow.
- **Gate: passed for public IDs across persisted API resources.** Request-wide transaction semantics and production integrations remain open.
