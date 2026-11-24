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
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.api import hires, tasks, sim
from app.api import events
from app.api import me
from app.api import admin
from app import auth
from app.config import settings
from app.services.scheduler import start_scheduler, stop_scheduler
from app.db.database import get_session


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()
app = FastAPI(
    title="Onboarding Orchestrator API",
    description="Cross-Team Employee Onboarding Orchestrator — CAT2-029",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for api_router in (hires.router, tasks.router, sim.router, me.router, admin.router, auth.users_router, auth.mail_router):
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
