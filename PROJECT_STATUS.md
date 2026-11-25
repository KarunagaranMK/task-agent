# OnboardFlow AI Project Status

This file tracks the master build prompt against the application implementation. A feature is marked verified only after an implementation and a relevant check.

## Current baseline

- The existing app has a Python FastAPI backend, React/TypeScript frontend, SQLite persistence and Alembic migrations.
- Existing behavior includes hire plans, task dependencies, CPM/slack, approvals, team ticket queues, manager/HR role controls, a monitor scheduler, notifications/SSE, audit records, what-if simulation, mock HRIS/ITSM MCP servers, an idempotent outbox, optional Gemini suggestions, and a seeded demo.
- MCP communication uses the official Python SDK with stdio server subprocesses.
- Existing tests and CI cover the current implementation. The most recent recorded baseline was 140 backend tests, 5 frontend component tests, and 11 browser E2E checks; frontend build and lint also passed in the previous implementation phase.
- The master prompt's customer-facing brand is **OnboardFlow AI**. Internal compatibility identifiers and demo credentials retain their historical name.

## Master prompt gap audit

| Area | Status | Notes |
|---|---|---|
| Authentication, secure password hashing, role-based API authorization | Implemented | Cookie-based refresh flow, Argon2, CSRF checks and role dependencies are present. |
| Employee onboarding and role-based plans | Implemented | Hires use validated dependency plans and can preview role-specific plans. |
| CPM, slack, deadline risk, recovery fallback | Implemented | Backend calculation and stall recovery are deterministic. |
| Approval workflow | Implemented | Manager approval/rejection is persisted and audited. |
| MCP HRIS/ITSM integrations | Implemented | Local mock services communicate over real MCP stdio sessions. |
| Idempotent ticketing and outbox retries | Implemented | Durable SQL rows and duplicate-prevention keys are present. |
| Notifications and near-real-time updates | Implemented | Persistent in-app notifications and authorized SSE tickets are present. |
| What-if simulation | Implemented | The simulation uses a copy of the workflow state. |
| LangGraph supervisor and specialized worker graph | Implemented | The graph routes plan/monitor runs and invokes deterministic planner, monitor, IT, Facilities, and HRIS nodes. |
| Durable LangGraph checkpoints and graph interrupts | Implemented | SQLite checkpointer stores graph state; a manager approval interrupt resumes against the same thread. |
| React Flow dependency graph | Implemented | Hire detail has interactive pan/zoom, minimap, fit controls, task selection, critical styling, and connected-task highlighting. |
| Agent activity/control center | Implemented | Agent execution history and monitor action are backed by persisted `AgentExecution` records. |
| Integration health dashboard | Implemented | ITSM/HRIS MCP checks, Gemini setup, scheduler, and retry outbox are summarized on a dedicated page. |
| Employee CRUD and archive lifecycle | Implemented | Hires can be created, edited, searched, filtered and archived with confirmation; optional work contact, location, employment type, equipment, software/access and notes are persisted and shown on the profile. |
| React Hook Form/Zod form validation | Implemented | The three-step hire wizard uses React Hook Form with Zod schema validation and Pydantic validation at the API boundary. |
| Brand and product naming | Implemented | Customer-facing product labels and API metadata now use OnboardFlow AI; compatibility keys and seeded demo password remain stable. |
| Setup, architecture and demo documentation | Implemented | README now explains the stack, model boundary, workflow stages, and local/container startup. |
| CI lint/test/build coverage | Implemented | CI runs the backend suite, scoped Ruff check, frontend build, and component tests. |
| Docker and cloud deployment | Implemented with limitation | Frontend and backend containers plus Compose persistence/proxy are configured with demo mode disabled; Docker is not installed here, so container execution was not verified. A hosting provider/account is still needed for public deployment. |

## Implementation phases

1. Foundation audit, app identity, environment safety and status tracking.
2. Add LangGraph supervisor/worker orchestration with durable checkpoints while retaining deterministic safeguards.
3. Add useful agent and integration observability backed by persisted application state.
4. Improve employee/workflow/graph experiences and plan review where gaps remain.
5. Complete CI, Docker, deployment and faculty-facing documentation.
6. Run relevant checks and record only observed results.

## Verified in this alignment

- Frontend TypeScript/Vite production build: passed.
- Frontend component tests: **5 passed**.
- Ruff check on the new LangGraph/API modules: passed with the repository's established FastAPI dependency injection and naive-UTC conventions excluded (`B008`, `DTZ003`).
- Docker Compose syntax and image builds could not be run because Docker is not installed in this environment.
- After adding profile persistence coverage, full backend suite: **148 passed**; fresh SQLite migrations upgrade cleanly through `0018_employee_profile`.
- Employee profile details now validate at the API and form boundaries, persist in Alembic-managed columns, and can be edited or reviewed from the hire overview.

## Known limits

- The live Gemini provider is optional; plans fall back to templates if no key is configured.
- HRIS and ITSM are local mock enterprise services, not vendor production accounts.
- The existing readiness experiment is illustrative simulation data.
- Vercel and Render deployment templates exist, but no cloud hosting accounts or deployed services are connected to this checkout.
