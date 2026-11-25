# Product Review — OnboardIQ Cross-Team Employee Onboarding Orchestrator

**Problem ID:** CAT2-029
**Review date:** November 25, 2026
**Position:** Local-first product prototype; integrations and performance evidence are not production-certified.

## Problem

New-hire readiness depends on work across HR, IT, Facilities, managers, and the hire. Each group owns its own actions and systems. A static checklist can show tasks, but coordinating prerequisites, approvals, delays, ownership, and a fixed first-day deadline across those systems takes ongoing human follow-up.

OnboardIQ models onboarding as a role-specific task graph, calculates the remaining critical path, routes approval-gated work, and surfaces stalls. Humans still perform the underlying work, such as preparing equipment, granting access, and issuing badges.

## Existing Solutions

Dependency modeling is already available in mainstream project tools, and enterprise HR platforms offer onboarding workflows. OnboardIQ does **not** claim that other products lack dependencies, automation, or cross-team onboarding. The product question is whether a lightweight, vendor-neutral coordinator can make live critical-path risk, stall recovery, and evidence easier to inspect across independently owned systems.

| Category | Publicly described capability | Positioning note |
|---|---|---|
| Work-management tools (Asana, monday.com) | Task dependencies and timeline/Gantt planning are documented by both vendors. ([Asana](https://asana.com/features/project-management), [monday.com](https://support.monday.com/hc/en-us/articles/360007402599-Dependencies-on-monday-com)) | Dependency graphs alone are not a differentiator. Compare the customer’s configured workflows and connected systems. |
| HR and payroll platforms (BambooHR, Gusto, Rippling) | Vendor materials describe onboarding tasks, documents, checklists, payroll setup, or IT provisioning, with capabilities varying by product and plan. ([BambooHR](https://www.bamboohr.com/platform/onboarding/), [Gusto](https://support.gusto.com/article/100201315100000/set-up-your-gusto-account-for-employees), [Rippling](https://www.rippling.com/products/it)) | These products can cover meaningful portions of onboarding. Avoid broad claims about what a particular deployment can or cannot integrate. |
| Enterprise HCM and employee-service platforms (Workday, ServiceNow) | Workday documents configurable onboarding steps that may be sequential or parallel. ServiceNow describes multidepartment employee journeys and onboarding/transitions. ([Workday](https://doc.workday.com/admin-guide/en-us/manage-workday/business-processes/business-processes-guidelines/onboarding-business-process-guidelines.html?toc=6.9.5), [ServiceNow](https://www.servicenow.com/products/employee-journey.html)) | These platforms address adjacent and overlapping workflows; compare implementation scope, integrations, governance, and customer requirements. |
| SAP SuccessFactors Onboarding Task Management Agent | SAP describes risk-based ranking that considers due dates, compliance, and downstream dependencies. SAP’s product page states that the agent is available to eligible customers in an Early Adopter Care program. ([SAP Help](https://help.sap.com/docs/AUTONOMOUS_HCM/2811d23231ec4dd3870db54f5693b266/9bbcc285b27f4a82a23cdd42ad23c019.html), [SAP product page](https://www.sap.com/products/hcm/onboarding-task-management-agent.html)) | This is a close and relevant comparator. Confirm current program status and availability with SAP before external use. |
| Robotic process automation (UiPath) | UiPath describes RPA as automating repetitive, rule-based work across applications and systems, and positions RPA as an execution layer alongside agents. ([UiPath RPA](https://www.uipath.com/rpa/robotic-process-automation)) | Automation can complement onboarding orchestration. Do not frame RPA as categorically unable to manage workflows. |

**Vendor-fact check:** Product names, features, packaging, and availability change. Recheck each linked official product page and the customer’s contracted edition before presenting competitor comparisons externally. This review summarizes public vendor materials; it is not an independent product evaluation.

## Our Solution

OnboardIQ is a runnable local application. HR creates a hire against a joining date; a validated role template supplies a dependency graph. The deterministic monitor dispatches eligible work through local MCP mock services, records ticket state, applies approvals, recalculates readiness, and targets escalations to stalled critical or near-critical tasks. The admin template editor supports adding tasks, editing prerequisites, validation, and versioned publish.

The LLM boundary is narrow: optional task suggestions, plain-language risk explanations, and escalation drafts. Pydantic validation and deterministic fallbacks keep the application usable without an API key. Scheduling, dispatch, authorization, critical-path calculations, and recovery decisions remain code-driven.

## Uniqueness

These are the product’s intended differentiators and testable design choices, **not claims of category exclusivity**:

- **U1 — Live critical path:** Recompute forward/backward CPM on remaining open-task durations, and expose per-task slack and deadline risk.
- **U2 — Targeted recovery:** Detect idle or overdue work; escalate and apply a configured fallback only when work is critical or near-critical, reducing unnecessary alerts.
- **U3 — MCP boundary:** Route external-system operations through MCP tools. The current application uses local mock services; real ServiceNow, Workday, or other vendor integrations are not included.
- **U4 — Reliability:** Use idempotency keys, a durable outbox, and a database-backed scheduler lease to support retries and restart recovery in the local demo.
- **U5 — Governance:** Enforce role permissions in the backend; gate sensitive tasks on manager approval; retain human and agent audit activity.
- **U6 — Evidence:** Include a seeded, deterministic experiment comparing a static checklist policy with the orchestrator policy. Its synthetic result is illustrative and must not be represented as measured customer impact.

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SQLModel/SQLAlchemy, Alembic, SQLite by default, and APScheduler with a database lease.
- **Integration and AI:** FastMCP local mock services for ITSM/HRIS; optional Gemini features with deterministic fallbacks; local database mail outbox by default.
- **Frontend:** React, Vite, strict TypeScript, React Router, TanStack Query, Recharts, Lucide icons, and responsive light/dark styling.
- **Verification:** 135 backend tests; 90.6% combined coverage across CPM, planner, clock, and experiment modules; Playwright 11/11; axe checks in the browser suite; and a 198-image responsive screenshot matrix. A 100-request local API profile at concurrency 10 had zero failures and approximately 310 ms p95 on the recorded Windows development machine. This is a local baseline, not a production service-level objective.

## MVP/Product

### How to try it

Requirements are Python 3.11+ and Node.js 20+. From the repository root, run `python run.py`. The local UI is at `http://localhost:5173`; API docs are at `http://localhost:8000/docs`. In demo mode, use the sign-in page’s account chips or these accounts (shared password: `OnboardIQ-Demo!`):

- `admin@demo.local`
- `hr@demo.local`
- `manager@demo.local`
- `it@demo.local`
- `facilities@demo.local`
- `newhire@demo.local`

### Implemented in the local demo

- Backend-enforced role workspaces, user/invitation flows, password/session security controls, and scoped manager, team, and new-hire access.
- Hire creation, role-specific plan preview, hire portfolio search/filter/sort/pagination, saved local views, CSV export, audited detail edits, safe pre-work role changes, and pause/resume/cancel lifecycle actions.
- Task dependencies, approval queue, team ticket console, onboarding self-service, issues, activity history, notifications, critical-path/schedule views, what-if calculation, insights, and deterministic experiment UI.
- Versioned template editing with drag-to-connect handles, click-to-connect and keyboard paths, cycle validation, and task settings.
- Demo controls for simulation time and mock-system failures; local mail outbox; generated API types; `/health` and database-aware `/ready` endpoints.

### Mocked behavior and known gaps

- ITSM and HRIS are local mock systems; the UI’s ticket actions represent the human work. No production vendor credentials or integrations are configured. Email is stored in the local outbox unless SMTP is configured. The auto-worker is a demo convenience.
- The application exposes integer database IDs through its API; the brief’s UUID API-ID convention is not implemented. Scheduling persists real joining dates but CPM/monitor elapsed time still uses simulation-relative business-day indices.
- Template APIs cap a plan at 40 tasks. Dedicated Vitest/Testing Library component tests are not installed. The local API profile is a small development baseline, not production-scale load or security certification. GNU Make was unavailable in the Windows environment, so `make verify` has not been invoked as one aggregate command; its constituent checks were run separately.
- LangGraph is not configured; the default deterministic orchestrator remains active. Production vendor integrations, distributed rate limiting, production deployment scaling, and production security review are outside this local demo’s verified scope.

Further implementation details, decision history, and phase evidence are in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/DEMO.md`](DEMO.md), and [`docs/PROGRESS.md`](PROGRESS.md).
