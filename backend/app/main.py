from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import os
from app.db.database import create_db, get_session
from app.api import hires, tasks, sim
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Test clients provide their own isolated session; touching the file database
    # during their startup can block on a separate local demo server.
    if get_session not in app.dependency_overrides:
        create_db()
    yield


app = FastAPI(
    title="Onboarding Orchestrator API",
    description="Cross-Team Employee Onboarding Orchestrator — CAT2-029",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hires.router)
app.include_router(tasks.router)
app.include_router(sim.router)

@app.get("/health")
def health():
    return {"status": "ok", "service": "onboarding-orchestrator"}


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
