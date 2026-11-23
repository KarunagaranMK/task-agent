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

## Known decisions still pending

- The deterministic in-process MCP adapters remain until persistent stdio client tests are implemented.
- The demo role selector remains a visual prototype; it does not enforce backend RBAC.
- The optional LangGraph adapter stays disabled until the default orchestrator passes its expanded test suite.
