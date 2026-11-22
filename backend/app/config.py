from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./onboarding.db"
    SIM_MODE: bool = True
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_API_KEY: Optional[str] = None
    ITSM_OFFLINE: bool = False

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
