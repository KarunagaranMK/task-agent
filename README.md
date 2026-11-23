# Cross-Team Employee Onboarding Orchestrator

> **CAT2-029** · MVP Demo-Ready · November 2026

A multi-agent AI system that orchestrates cross-team (IT, HR, Facilities) employee onboarding with **critical-path scheduling**, **automatic stall detection**, **self-healing fallbacks**, and a governance layer — all vendor-neutral via MCP tools.

---

## 🚀 Quick Start

Prerequisites: **Python 3.11+** and **Node.js 20+**. The local demo uses SQLite; Docker, Postgres, SMTP, and an LLM key are not required.

Run the same command in Windows PowerShell, macOS Terminal, or Linux:

```bash
python run.py
```

The launcher creates a virtual environment, installs dependencies, creates `.env`, applies SQLite migrations, seeds the demo once, starts the API and frontend, checks health, and opens the browser.

Useful options:

```bash
python run.py --reset          # restore a fresh demo database
python run.py --test           # backend tests and frontend build
python run.py --no-browser     # start without opening a browser
python run.py --prod --no-browser  # serve the built UI and API on :8000
```

The current prototype uses a client-side role switcher; it does not yet provide login or backend-enforced RBAC. The demo has no passwords or real user accounts.

| Issue | What to check |
|-------|---------------|
| Port 8000 or 5173 is in use | Stop the service using that port, then rerun `python run.py`. |
| Wrong Node version | Install Node.js 20 or newer and verify with `node --version`. |
| Missing virtual environment | Run `python run.py` again; it creates `.venv` automatically. |
| SQLite database is locked | Close another app instance using `backend/onboarding.db`; then retry. Use `--reset` only when you want to recreate the demo data. |

No API key is required; unavailable LLM features use deterministic template text.

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                   React Frontend (Vite + TS)                     │
│  HR Page · Hire Detail · Manager Inbox · IT Console · Insights   │
│                    Demo Panel (sim controls)                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │  REST / JSON
┌───────────────────────────▼──────────────────────────────────────┐
│                    FastAPI Backend                               │
│  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────┐  │
│  │  Planner  │  │  CPM     │  │ Monitor   │  │ Experiment  │  │
│  │ (DAG gen) │  │ Engine   │  │  Tick     │  │ Simulation  │  │
│  └───────────┘  └──────────┘  └───────────┘  └─────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  SQLite · Idempotent Outbox · Audit Log · Notifications    │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬──────────────────────────────────────┘
              MCP stdio      │
        ┌────────────────────┼────────────────┐
        ▼                    ▼                ▼
    ITSM-MCP             HRIS-MCP       (plug in real
    (mock)               (mock)          ServiceNow/
                                         Workday MCP)
```

---

## 🎯 Key Differentiators

| Feature | How it works |
|---------|-------------|
| **U1 CPM Engine** | Forward/backward pass on live remaining durations; slack per task; negative slack = Day-1 at risk |
| **U2 Self-Healing** | Stall ≥ 2 idle days → escalate to Manager + IT → reschedule with fallback (loaner laptop = 1 day) |
| **U3 Vendor-Neutral** | Every external call goes through MCP stdio tools; swap mock for real in zero agent code changes |
| **U4 Reliability** | Idempotency key = `hire{id}:{task_key}`; outbox queue survives ITSM outage; zero duplicate tickets |
| **U5 Governance** | Manager approval gate for sensitive access; full audit log (day, actor, level, message) |
| **U6 Evidence** | 200-hire Monte Carlo: Orchestrator **~22 pp better** Day-1 readiness vs static checklist |

**LLM boundary:** Gemini used only for (a) role-specific task extras, (b) risk explanations. All scheduling decisions are deterministic Python. Works with no API key.

---

## 📊 Experiment Results

| Policy | Day-1 Readiness |
|--------|----------------|
| Static Checklist | ~65% |
| Orchestrator | ~87% |
| **Improvement** | **+22 pp** |

> ⚠️ Illustrative Monte Carlo simulation (seed=42, n=200, stall_prob=0.2). Verify with production data.

---

## 🔧 Tech Stack

- **Backend:** Python 3.11, FastAPI, Pydantic v2, SQLModel (SQLite / Postgres-ready)
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS v4, TanStack Query, Recharts
- **AI/LLM:** Google Gemini free tier (`gemini-2.5-flash`), template fallbacks
- **MCP:** FastMCP stdio servers (ITSM mock, HRIS mock)
- **DevOps:** Docker Compose, Makefile, GitHub Actions CI

---

## 📖 API Reference

OpenAPI docs: **http://localhost:8000/docs**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/hires` | Register new hire + generate plan |
| GET | `/hires` | List all hires |
| GET | `/hires/{id}` | Hire detail |
| GET | `/hires/{id}/tasks` | Task list with CPM data |
| GET | `/hires/{id}/audit` | Audit timeline |
| GET | `/hires/{id}/explain` | AI risk explanation |
| POST | `/tasks/{id}/approve` | Manager approve |
| POST | `/tasks/{id}/reject` | Manager reject |
| GET | `/tickets` | All ITSM tickets |
| POST | `/tickets/{id}/complete` | IT marks done |
| POST | `/tickets/{id}/stall` | IT stalls ticket |
| POST | `/sim/advance` | Advance sim day + run monitor |
| POST | `/monitor/tick` | Manual monitor run |
| POST | `/chaos/itsm?offline=true` | Toggle ITSM outage |
| POST | `/experiments/run` | Run comparison experiment |
| GET | `/metrics` | Dashboard KPIs |
| GET | `/notifications` | Notifications (filter by role) |
| POST | `/reset` | Reset all demo data |

---

## 🎬 Demo Scenario

See [`docs/DEMO.md`](docs/DEMO.md) for the step-by-step Priya Sharma demo.

---

## 📸 Screenshots

_[Add screenshots after first run — HR Page, Hire Detail with critical path, Manager Inbox, IT Console, Insights chart]_

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
├── docs/                     # Architecture, demo, review
├── docker-compose.yml
├── Makefile
└── .github/workflows/ci.yml
```
