# OnboardFlow AI

> **CAT2-029** · Local onboarding orchestration demo · November 2026

A cross-team onboarding workflow app for HR, managers, IT, and Facilities. It coordinates onboarding tasks with **critical-path scheduling**, **stall monitoring**, **configured fallbacks**, and an audit trail. A supervised LangGraph workflow records durable checkpoints, while business decisions remain deterministic and integrations use MCP adapters.

HR creates plans against a real joining date. The organization timezone and editable holiday calendar drive business-day mapping and projected-ready dates, while the demo clock keeps the scheduling scenario deterministic.

## Explain the project in one minute

OnboardFlow AI gives the teams involved in a new hire's first day one shared plan. HR creates the hire, the planner builds dependent tasks, and the Critical Path Method (CPM) estimates which tasks can delay Day 1. Managers approve sensitive access; IT and Facilities process their assigned work. A LangGraph supervisor routes planning and monitoring work to specialized nodes. A monitor checks progress, records changes, and can escalate a stalled critical task or apply a configured fallback. The dashboard updates readiness and notifications.

The application uses a **supervised agent workflow**, not an unconstrained autonomous agent. LangGraph routes tasks, persists checkpoints in SQLite, and pauses a workflow at the manager approval gate. Normal workflow decisions use explicit application rules. Optional Gemini calls help draft text or suggest tasks; they do not approve access or decide schedules.

For the interactive walkthrough, open **Project guide** from the sign-in screen or go to `/guide`. For the full role-by-role sample, see [`docs/DEMO.md`](docs/DEMO.md).

---

## 🚀 Quick Start

Prerequisites: **Python 3.11+** and **Node.js 20+**. The local demo uses SQLite; Docker, Postgres, SMTP, and an LLM key are not required.

Run the same command in Windows PowerShell, macOS Terminal, or Linux:

```bash
python run.py
```

The launcher creates a virtual environment, installs dependencies, creates `.env` with a generated signing secret, applies SQLite migrations, seeds the demo workspace, starts the API and frontend, checks health, and opens the browser. The API uses SQLite by default; Docker, an SMTP server, and an LLM key are optional.

Useful options:

```bash
python run.py --reset          # restore a fresh demo database
python run.py --test           # backend tests and frontend build
python run.py --no-browser     # start without opening a browser
python run.py --prod --no-browser  # serve the built UI and API on :8000
make verify                    # backend tests, frontend build, browser E2E + axe
npm --prefix frontend run qa:shots  # responsive screenshot matrix
docker compose up --build      # run frontend + API containers on port 3000
```

For the container setup, put `JWT_SECRET` in the project `.env` file before `docker compose up --build`. Compose runs with `DEMO_MODE=false` and does not seed public demo users; after startup, create the first administrator with `docker compose exec backend python -m app.cli create-admin`. Set `COOKIE_SECURE=true` when serving the frontend over HTTPS. An optional `GEMINI_API_KEY` enables Gemini suggestions. Docker Compose stores the app database, LangGraph checkpoints, and mock MCP data in the persistent `backend_data` volume. This is a single-instance deployment; public production use still needs a selected hosting provider, HTTPS termination, and an appropriate managed database/backup plan.

### Vercel + Render deployment template

The repository includes a Vercel SPA/API proxy config at [`frontend/vercel.json`](frontend/vercel.json) and a Render Docker blueprint at [`render.yaml`](render.yaml). In Vercel, set the project root to `frontend` and connect the GitHub repository. In Render, create a Blueprint from the repository; the blueprint uses a persistent disk for SQLite and checkpoints, which requires a paid single-instance service. Set `FRONTEND_ORIGINS` in Render to the exact Vercel production origin (and any custom frontend origin), then deploy. The Vercel rewrite targets `https://onboardflow-ai-api.onrender.com`; update it if the Render service receives a different hostname. Create the first admin through the Render shell with `python -m app.cli create-admin`. Configure optional `GEMINI_API_KEY` in Render if you want model suggestions.

For a repeatable local API baseline, start the app with `python run.py --no-browser`, then run
`python scripts/profile_api.py --requests 100 --concurrency 10` in another terminal. The profile logs in as the seeded
HR account and sends authenticated, read-only requests to the hire portfolio and metrics endpoints. Override
`ONBOARDIQ_PROFILE_EMAIL` and `ONBOARDIQ_PROFILE_PASSWORD` to use another HR account. The JSON report includes
throughput, status counts, and p50/p95/max latency; results describe the local machine and are not production SLOs.

In demo mode, use the account chips on `/login`. All six seeded accounts share `OnboardIQ-Demo!`: Admin, HR, Manager, IT, Facilities, and New hire. Role permissions are enforced by the API. Seeded people and ITSM/HRIS data are local demo records backed by deterministic MCP mock systems.

| Issue | What to check |
|-------|---------------|
| Port 8000 or 5173 is in use | Stop the service using that port, then rerun `python run.py`. |
| Wrong Node version | Install Node.js 20 or newer and verify with `node --version`. |
| Missing virtual environment | Run `python run.py` again; it creates `.venv` automatically. |
| SQLite database is locked | Close another app instance using `backend/onboarding.db`; then retry. Use `--reset` only when you want to recreate the demo data. |

No API key is required; unavailable LLM features use deterministic template text. LangGraph checkpoints are stored in `onboarding.checkpoints.sqlite` by default; set `LANGGRAPH_CHECKPOINT_DB` to move that file.

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│            React + TypeScript frontend (Vite)                    │
│ HR · Manager · IT/Facilities · New Hire · Admin · Insights       │
│ Responsive portals · React Flow · charts · live updates          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST / JSON + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│                    FastAPI + SQLModel                            │
│ Auth/RBAC · hire/task APIs · CPM · audit · outbox · notifications │
│        LangGraph supervisor + SQLite checkpointer                │
│   Planner → approval interrupt → monitor → workers               │
└───────────────┬────────────────────────────────┬─────────────────┘
                │ MCP stdio                      │ Optional LLM
      ┌─────────▼────────┐             ┌────────▼──────────┐
      │ ITSM + HRIS mocks │             │ Gemini suggestions │
      │   Python MCP      │             │  safe fallback     │
      └───────────────────┘             └───────────────────┘
```

### What happens when HR creates a hire

1. The API validates the hire data and gets a role plan from a published template. Gemini may suggest task wording when configured; validation and template fallback remain authoritative.
2. CPM orders tasks by dependency, estimates remaining work, and calculates slack against the joining date.
3. The monitor workflow is invoked by the scheduler or an authorized manual action. The supervisor routes it to the deterministic monitor node.
4. Sensitive work pauses at the approval gate. LangGraph saves the workflow state and thread ID in SQLite; the manager's decision resumes that thread.
5. Specialized IT, Facilities, and HRIS nodes reconcile system state through MCP stdio tools. Retryable ticket creation is persisted in the idempotent outbox.
6. The API records agent executions, audit events, and notifications. The UI receives live events and shows readiness, critical work, integrations, and agent activity.

---

## 🎯 Key Differentiators

| Feature | How it works |
|---------|-------------|
| **U1 CPM Engine** | Forward/backward pass on live remaining durations; slack per task; negative slack = Day-1 at risk |
| **U2 Self-Healing** | Stall ≥ 2 idle days → escalate to Manager + IT → reschedule with fallback (loaner laptop = 1 day) |
| **U3 Vendor-Neutral** | ITSM and HRIS tasks use MCP stdio tools; replace mock servers with vendor adapters |
| **U4 Reliability** | Idempotency key = `hire{id}:{task_key}`; outbox queue survives ITSM outage; zero duplicate tickets |
| **U5 Governance** | Manager approval gate for sensitive access; full audit log (day, actor, level, message) |
| **U6 Evidence** | 200-hire Monte Carlo: Orchestrator **~22 pp better** Day-1 readiness vs static checklist |

**LLM boundary:** Gemini is optional and used only for role-specific task suggestions, risk explanations, and escalation drafts. Validated deterministic fallbacks keep the product usable without a key. LangGraph routes work and checkpoints approvals; scheduling, authorization, dispatch, and recovery decisions are code-driven.

---

## 📊 Experiment Results

| Policy | Day-1 Readiness |
|--------|----------------|
| Static Checklist | ~65% |
| Orchestrator | ~87% |
| **Improvement** | **+22 pp** |

> ⚠️ Illustrative Monte Carlo simulation (seed=42, n=200, stall_prob=0.2). Verify with production data.

---

## 🧭 Workspaces and interactions

- **HR:** hire list and creation wizard, readiness and critical-path detail, audit, insights, and export.
- **Manager:** assigned hires, access approvals and recent-action undo.
- **IT and Facilities:** team-scoped ticket queues with start, block, stall, complete, and comment actions.
- **New hire:** a privacy-scoped progress timeline and issue reporting.
- **Admin:** users/invites, versioned role templates, service guardrails, audit search/export, demo clock, and outage controls.
- **All roles:** responsive light/dark layouts, notification preferences, profile settings, keyboard navigation, and contextual demo controls.

The API schema is available at **http://localhost:8000/docs** while the app is running. TypeScript API contracts are generated from FastAPI OpenAPI with `npm --prefix frontend run typegen:api`.

For the complete architecture walkthrough, Mermaid diagrams, model boundaries, and role-by-role user guide, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 🧰 Technology and model details

- **Backend:** Python 3.11+, FastAPI for HTTP APIs and SSE events, Pydantic for request/response validation, SQLModel for persistence models, Alembic for schema migrations, APScheduler for monitoring, and SQLite for local demo data.
- **Frontend:** React, Vite, strict TypeScript, Tailwind CSS, TanStack Query for API state, React Hook Form + Zod for hire form validation, React Flow (`@xyflow/react`) for dependency visualization, Recharts for charts, and React Router for role workspaces.
- **Integrations:** FastMCP stdio clients with local mock ITSM and HRIS servers; the outbox records retryable ticket work.
- **Model:** Google Gemini `gemini-2.5-flash` is optional and configured by `GEMINI_MODEL`. With `GEMINI_API_KEY`, it can suggest role-specific tasks and draft risk explanations or escalation messages. The app validates responses and falls back to templates when the model is unavailable. Without an API key, the demo still works.
- **Deterministic application logic:** CPM scheduling, business-day calculations, authentication and role checks, manager approvals, ticket dispatch, duplicate protection, stall thresholds, recovery choices, and audit events do not depend on a model.
- **Agent orchestration:** LangGraph's supervisor graph routes planning and monitor operations, calls specialized worker nodes, persists checkpoints in SQLite, and pauses/resumes sensitive approvals. The graph is supervised and does not replace deterministic business rules with model output.
- **Quality:** pytest, Ruff, Playwright, axe-core, coverage gate, and responsive screenshot matrix.

This is a local-first demonstration. The ITSM and HRIS services are mocks, outbound email is a local database outbox, and the experiment results are illustrative simulation data. Real vendor systems, SMTP delivery, production SSO, and production performance/security certification are not configured.

---

## 🎬 Demo Scenario

See [`docs/DEMO.md`](docs/DEMO.md) for the complete sample: create a hire, review its plan, move work between roles, demonstrate approval and recovery, and finish at Day-1 readiness.

---

## 📸 Screenshots

The responsive matrix (all role routes at 390/768/1440 px, light and dark, plus the hire Graph and Schedule views) contains **198 screenshots** in [`docs/screenshots/`](docs/screenshots/).

![OnboardFlow AI overview at desktop width](docs/screenshots/admin-overview-1440-light.png)

![New hire onboarding timeline in dark mode](docs/screenshots/new-hire-my-onboarding-1440-dark.png)

---

## 📁 Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app
│   │   ├── config.py         # Settings
│   │   ├── domain/models.py  # SQLModel entities
│   │   ├── db/database.py    # Engine + session
│   │   ├── services/
│   │   │   ├── cpm.py        # Critical Path Method
│   │   │   ├── planner.py    # DAG generation
│   │   │   ├── orchestrator.py # Dispatch, stall, reschedule
│   │   │   └── experiment.py # Monte Carlo simulation
│   │   └── api/              # FastAPI routers
│   ├── mcp_servers/          # ITSM + HRIS mock MCP
│   ├── tests/                # pytest suite
│   └── seed.py               # Demo data loader
├── frontend/                 # React + Vite app
├── docs/                     # Architecture, decisions, progress, demo, screenshots
├── qa/                       # Browser acceptance, accessibility, visual QA
├── docker-compose.yml
├── Makefile
└── .github/workflows/ci.yml
```
