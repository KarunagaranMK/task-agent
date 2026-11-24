# Monday Review — Cross-Team Employee Onboarding Orchestrator

**Problem ID:** CAT2-029 | **Date:** November 2026 | **Status:** MVP Demo-Ready

---

## Problem

When a new employee joins, three separate teams must act in parallel:
- **IT** must provision laptop, accounts, VPN, and software licenses
- **HR** must complete contracts, enroll in payroll, and assign training
- **Facilities** must issue a security badge and assign a desk

Today these teams operate in silos using static checklists (Excel, Asana templates). **Tasks stall silently** — nobody sees dependencies between teams, nobody is notified when a critical blocker is idle, and there is no mechanism to reschedule automatically. The result: **Day-1 readiness is missed**, the new hire arrives to no laptop and no access, losing productivity from day one and creating a poor first impression.

---

## Existing Solutions

> ⚠️ **Verify all vendor claims against their official product pages before presenting externally.**

| Solution | Capability | Gaps |
|----------|-----------|------|
| Excel / Asana / Monday.com templates | Static task checklists | No dependency modelling; no reaction to delays; no cross-team orchestration |
| BambooHR / Rippling onboarding | HR-centric checklists and workflows | Cannot control IT or Facilities systems they don't own |
| Workday Onboarding | Workflow automation within Workday | Proprietary ecosystem; costly; limited to systems Workday owns |
| ServiceNow HR Service Delivery / Employee Journey Management | Onboarding journeys within ServiceNow | Proprietary; expensive licencing; siloed within ServiceNow footprint |
| SAP SuccessFactors + Onboarding Task Management Agent | AI agent prioritising tasks by risk, due dates, dependencies | Proprietary SAP ecosystem; expensive; still lives inside one vendor |
| UiPath RPA | Automates data entry between HRIS and ITSM | Brittle to UI changes; no semantic reasoning or fallback logic |

**Gaps we target:** None of the above combines (a) explicit CPM-based critical-path reasoning, (b) automatic stall detection with self-healing fallbacks, (c) vendor-neutrality via open MCP tooling, and (d) honest quantitative evidence of improvement.

---

## Our Solution

```
HR registers hire → Plan Generator builds task DAG (role template + optional LLM extras)
                  ↓
Supervisor checks dependency graph every monitor tick:
  → Dispatches tasks whose prerequisites are done (idempotent ticket per task)
  → Routes approval-gated tasks to Manager inbox first
                  ↓
Approval Gate: Manager approves/rejects sensitive access (Power BI, repo access)
                  ↓
Progress Monitor (triggered by "Advance Day" or APScheduler):
  1. Drain outbox → retry queued tickets if ITSM recovered
  2. For each hire: dispatch newly unblocked tasks
  3. Run CPM → compute ES/EF/LS/LF/slack per open task
  4. Detect stalls (≥ 2 idle days OR overdue) on critical/near-critical path
  5. Escalate → notify Manager + IT team
  6. Apply fallback (loaner laptop, 1 day) → re-dispatch automatically
  7. Update hire status (on_track / at_risk / ready) and readiness %
                  ↓
IT / Facilities humans complete actual work (Start → Complete / Stall buttons)
                  ↓
When all tasks done → hire.status = ready → Day-1 achieved ✅
```

The LLM (Gemini) is used **only** for:
- Adding up to 2 role-specific extra tasks to the template plan (validated with Pydantic)
- Generating a plain-English risk explanation ("Why is this at risk?")
- Drafting escalation messages

All scheduling, dispatch, CPM, stall detection, and rescheduling decisions are **deterministic Python**. No API key required.

---

## Uniqueness

### U1 — Critical-Path Engine
CPM forward/backward pass recomputed on **live remaining durations** (not original estimates) after every monitor tick. Outputs ES/EF/LS/LF/slack per task. **Negative min_slack means Day-1 is at risk** and projected_day is updated accordingly. Covered by 14 unit tests in `test_cpm.py`.

### U2 — Self-Healing
- **Stall detection:** no `last_activity_day` update for ≥ 2 days OR elapsed > duration
- **Alert targeting:** only act on tasks where `slack ≤ min_slack + 1` to avoid alert fatigue
- **Action:** escalate to Manager + IT lead AND reschedule with fallback (e.g., loaner laptop = 1 day)
- **Result:** critical-path slack recovers; hire can still be ready on Day-1

### U3 — Vendor-Neutral via MCP
Every external system call (ITSM ticket creation, HRIS status update) goes through **FastMCP stdio tools**. The mock servers (`itsm_mcp.py`, `hris_mcp.py`) can be replaced with real ServiceNow MCP or Workday MCP servers with **zero changes to agent/orchestrator code** — only the MCP client configuration changes.

### U4 — Reliability
- **Idempotency key:** `hire{id}:{task_key}` — the same ticket is never created twice
- **Outbox pattern:** ITSM outage queues tickets; they drain automatically when ITSM recovers
- **Persistence:** SQLite survives process restarts; sim state is durable
- **Assertion in tests:** `test_drain_twice_no_duplicates` verifies zero duplicates

### U5 — Governance
- **Manager approval gate:** sensitive access tasks (Power BI, repo access) cannot be dispatched without explicit Manager approval via the UI or API
- **Full audit log:** every agent action records `(day, hire_id, actor_agent, level, message)`
- **Notifications:** Manager and IT team receive targeted notifications for approvals and escalations

### U6 — Quantitative Evidence

> ⚠️ Illustrative simulation. Methodology is stated explicitly and results labelled as such in the UI.

**Experiment:** 200 simulated hires, 20% stall probability, deterministic seed=42

| Policy | Day-1 Readiness |
|--------|----------------|
| Static Checklist (no intervention) | **~65%** |
| Orchestrator (CPM + stall rescue + fallback) | **~87%** |
| **Improvement** | **+22 percentage points** |

**Method:** Monte Carlo simulation. Each hire has 5 tasks; critical path = longest 3 sequential. Static: full stall delay applies. Orchestrator: 60% stall recovery on critical-path tasks (via fallback) + 0.5-day CPM rebalancing saving. Results are illustrative — verify with real deployment data.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend language | Python 3.11 | Typed, async-ready, rich AI ecosystem |
| API framework | FastAPI + Pydantic v2 | Auto OpenAPI, fast, typed |
| ORM / DB | SQLModel + SQLite | Simple MVP; Postgres-ready via env var |
| Scheduling | APScheduler (real-time) + sim clock (demo) | No external scheduler dependency |
| AI agents | Deterministic orchestrator (LangGraph structure) | Reliable, testable, no checkpoint fragility |
| LLM | Google Gemini `gemini-2.5-flash` free tier | Optional; full template fallbacks |
| MCP | FastMCP, stdio transport | Standard protocol; swap-in real servers |
| Frontend | React 18, Vite, TypeScript | Type-safe, fast HMR |
| Styling | Tailwind CSS v4 | Utility-first, dark mode |
| Data fetching | TanStack Query | Auto-refresh, caching |
| Charts | Recharts | Lightweight, composable |
| DevOps | Docker Compose, Makefile, GitHub Actions | Standard, reproducible |

---

## MVP/Product

### ✅ What Works (Demo-Ready)
- **Backend core:** hire registration, role-based plan generation (DAG with 8–10 tasks), monitor tick
- **CPM engine:** forward/backward pass, slack, critical path, stall detection — 14 unit tests
- **Self-healing:** stall → escalate → fallback reschedule (loaner laptop scenario)
- **Approval gate:** awaiting_approval state → Manager approves/rejects → dispatch proceeds
- **Idempotency:** outbox pattern, drain without duplicates — 3 dedicated tests
- **Audit log:** every agent action recorded with day, actor, level
- **Notifications:** Manager and IT role-filtered notification feed
- **Experiment:** deterministic Monte Carlo, reproducible across runs — 7 tests
- **React frontend:** HR Page, Hire Detail (tasks + audit), Manager Inbox, IT Console, Insights + bar chart, Demo Panel
- **Docker Compose:** backend + frontend containers with health check
- **GitHub Actions CI:** pytest + frontend build on every push
- **37 pytest tests** — all green

### 🟡 Mocked / Simplified
- **MCP transport:** in-process function calls (not subprocess stdio) for demo stability on Windows. MCP server files are present and runnable as stdio processes for production.
- **LLM:** template fallbacks active by default (no API key required for demo)
- **Auth:** role switcher is UI-only, no RBAC
- **ReactFlow graph:** task list with dependency display; full interactive graph is a next step
- **APScheduler:** wired but SIM_MODE=true used for demo control

### 🔜 Next Steps (Post-MVP, 2–4 weeks)
1. **Connect real MCP servers** — ServiceNow MCP, Workday MCP (zero agent changes)
2. **Email delivery** — escalation emails via SendGrid / SMTP
3. **Full LangGraph** — persistent interrupt/resume for distributed multi-instance deployment
4. **Interactive ReactFlow graph** — live-coloured dependency nodes with drag layout
5. **Postgres + Alembic** — schema migrations, multi-tenant row isolation
6. **WebSocket push** — replace TanStack Query polling with real-time SSE
7. **Production auth** — Auth0 or Okta OIDC + RBAC
