"""Strictly bounded optional Gemini copy generation with local fallbacks."""
from pydantic import BaseModel, Field, ValidationError

from app.config import settings


class EscalationDraft(BaseModel):
    message: str = Field(min_length=8, max_length=500)


def draft_escalation_message(hire_name: str, task_title: str, slack: float) -> str:
    fallback = f"Action needed: {task_title} for {hire_name} is stalled on the critical path ({slack:.1f} days of slack). Please confirm the next step or use the approved fallback."
    if not settings.GEMINI_API_KEY:
        return fallback
    try:
        from google import genai

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=(
                "Draft one concise, professional onboarding escalation message. "
                "Do not make decisions or invent facts. Return JSON with a single `message` string. "
                f"Hire: {hire_name}; stalled task: {task_title}; slack days: {slack:.1f}."
            ),
            config={"response_mime_type": "application/json", "response_schema": EscalationDraft},
        )
        parsed = EscalationDraft.model_validate_json(response.text or "")
        return parsed.message
    except (ImportError, ValidationError, ValueError, RuntimeError, AttributeError):
        return fallback
    except Exception:
        return fallback
