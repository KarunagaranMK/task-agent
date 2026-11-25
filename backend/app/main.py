from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from pathlib import Path
import os
from uuid import uuid4
from contextlib import asynccontextmanager
from threading import Lock
from time import monotonic
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.api import agents, hires, tasks, sim
from app.api import events
from app.api import me
from app.api import admin
from app import auth
from app.config import settings
from app.services.scheduler import start_scheduler, stop_scheduler
from app.db.database import get_session


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.agents.workflow import get_workflow_graph, close_workflow_graph
    get_workflow_graph()
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()
        close_workflow_graph()
app = FastAPI(
    title="OnboardFlow AI API",
    description="Supervised cross-team employee onboarding workflow API",
    version="1.0.0",
    lifespan=lifespan,
)

_API_RATE_WINDOW_SECONDS = 60
_API_RATE_LIMIT = 600
_API_RATE_BUCKETS: dict[str, list[float]] = {}
_API_RATE_LOCK = Lock()
_API_RATE_REQUEST_COUNT = 0
_API_PREFIXES = (
    "/api/", "/auth", "/users", "/hires", "/tickets", "/tasks", "/notifications",
    "/events", "/me", "/admin", "/settings", "/audit", "/templates", "/experiments",
    "/metrics", "/monitor", "/sim", "/dev",
)


def _api_rate_limited(client_ip: str, now: float) -> bool:
    global _API_RATE_REQUEST_COUNT
    with _API_RATE_LOCK:
        recent = [stamp for stamp in _API_RATE_BUCKETS.get(client_ip, []) if now - stamp < _API_RATE_WINDOW_SECONDS]
        if len(recent) >= _API_RATE_LIMIT:
            limited = True
        else:
            recent.append(now)
            _API_RATE_BUCKETS[client_ip] = recent
            limited = False
        _API_RATE_REQUEST_COUNT += 1
        if _API_RATE_REQUEST_COUNT % 256 == 0:
            expired = [ip for ip, stamps in _API_RATE_BUCKETS.items()
                       if not stamps or now - stamps[-1] >= _API_RATE_WINDOW_SECONDS]
            for ip in expired:
                _API_RATE_BUCKETS.pop(ip, None)
        return limited

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for api_router in (agents.router, hires.router, tasks.router, sim.router, me.router, admin.router, auth.users_router, auth.mail_router):
    for prefix in ("", "/api", "/api/v1"):
        app.include_router(api_router, prefix=prefix, dependencies=[Depends(auth.get_current_user)])
# The ticket endpoint authenticates itself with a JWT. The stream endpoint must
# accept the single-use ticket because native EventSource cannot send headers.
for prefix in ("", "/api", "/api/v1"):
    app.include_router(events.router, prefix=prefix)
    app.include_router(auth.router, prefix=prefix)


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request.state.request_id = str(uuid4())
    path = request.url.path
    health_check = path in {"/health", "/ready", "/api/health", "/api/ready", "/api/v1/health", "/api/v1/ready"}
    is_api = path.startswith(_API_PREFIXES)
    if is_api and not health_check and request.method != "OPTIONS" and _api_rate_limited(
        request.client.host if request.client else "unknown", monotonic()
    ):
        response = JSONResponse({
            "type": "about:blank",
            "title": "Too Many Requests",
            "status": 429,
            "code": "rate_limit_exceeded",
            "message": "Too many API requests. Try again shortly.",
            "detail": "The per-client API request limit has been reached.",
            "field_errors": [],
            "request_id": request.state.request_id,
        }, status_code=429, headers={"Retry-After": str(_API_RATE_WINDOW_SECONDS)}, media_type="application/problem+json")
    else:
        response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.exception_handler(StarletteHTTPException)
async def problem_http_exception(request: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "Request could not be completed"
    body = {
        "type": "about:blank",
        "title": "Request failed",
        "status": exc.status_code,
        "code": f"http_{exc.status_code}",
        "message": message,
        "detail": exc.detail,
        "field_errors": [],
        "request_id": getattr(request.state, "request_id", None),
    }
    return JSONResponse(body, status_code=exc.status_code, headers=exc.headers, media_type="application/problem+json")


@app.exception_handler(RequestValidationError)
async def problem_validation_exception(request: Request, exc: RequestValidationError):
    field_errors = [
        {"field": ".".join(str(part) for part in error["loc"][1:]), "message": error["msg"]}
        for error in exc.errors()
    ]
    body = {
        "type": "about:blank",
        "title": "Request validation failed",
        "status": 422,
        "code": "validation_error",
        "message": "Some request fields are invalid.",
        "detail": "Request validation failed",
        "field_errors": field_errors,
        "request_id": getattr(request.state, "request_id", None),
    }
    return JSONResponse(body, status_code=422, media_type="application/problem+json")

@app.get("/health")
@app.get("/api/health")
@app.get("/api/v1/health")
def health():
    return {"status": "ok", "service": "onboarding-orchestrator"}


@app.get("/ready")
@app.get("/api/ready")
@app.get("/api/v1/ready")
def ready(session=Depends(get_session)):
    try:
        session.exec(text("SELECT 1")).one()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="Database is not ready") from exc
    return {"status": "ready", "checks": {"database": "ok"}}


if os.getenv("SERVE_FRONTEND", "false").lower() == "true":
    frontend_dist = (Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()
    if frontend_dist.is_dir():
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="frontend-assets")

        @app.get("/{path:path}", include_in_schema=False)
        def frontend_route(path: str):
            candidate = (frontend_dist / path).resolve()
            if frontend_dist not in candidate.parents and candidate != frontend_dist:
                return FileResponse(frontend_dist / "index.html")
            if candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")
