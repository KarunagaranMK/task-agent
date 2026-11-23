from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import os
from app.api import hires, tasks, sim
from app import auth
app = FastAPI(
    title="Onboarding Orchestrator API",
    description="Cross-Team Employee Onboarding Orchestrator — CAT2-029",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for api_router in (hires.router, tasks.router, sim.router, auth.users_router, auth.mail_router):
    app.include_router(api_router, dependencies=[Depends(auth.get_current_user)])
    app.include_router(api_router, prefix="/api", dependencies=[Depends(auth.get_current_user)])
app.include_router(auth.router)
app.include_router(auth.router, prefix="/api")

@app.get("/health")
@app.get("/api/health")
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
