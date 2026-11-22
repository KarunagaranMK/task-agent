from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import create_db
from app.api import hires, tasks, sim
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
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
