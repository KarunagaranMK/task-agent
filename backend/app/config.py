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

    model_config = {"env_file": Path(__file__).resolve().parents[2] / ".env", "extra": "ignore"}


settings = Settings()
