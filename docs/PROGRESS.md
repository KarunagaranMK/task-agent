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

### Known gaps

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

## Next phase — P2 Domain core

1. Audit and complete the business-day clock/calendar, template DAG validation, plan preview, critical-path slack and what-if functions against the brief.
2. Add unit tests for cycle rejection, date boundaries, critical path, and what-if results; record verified gaps before committing P2.
