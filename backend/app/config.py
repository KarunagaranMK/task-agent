from pydantic_settings import BaseSettings
from typing import Optional
from pathlib import Path


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./onboarding.db"
    SIM_MODE: bool = True
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_API_KEY: Optional[str] = None
    ITSM_OFFLINE: bool = False
    DEMO_MODE: bool = True
    JWT_SECRET: str = "local-dev-only-change-this-secret"
    COOKIE_SECURE: bool = False
    MCP_MODE: str = "stdio"
    SCHEDULER_ENABLED: bool = True
    MONITOR_INTERVAL_MINUTES: int = 15
    LANGGRAPH_CHECKPOINT_DB: Optional[str] = None
    FRONTEND_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"

    @property
    def allowed_frontend_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.FRONTEND_ORIGINS.split(",") if origin.strip()]

    model_config = {"env_file": Path(__file__).resolve().parents[2] / ".env", "extra": "ignore"}


settings = Settings()
