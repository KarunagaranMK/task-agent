"""Strictly bounded optional Gemini copy generation with local fallbacks."""
from pydantic import BaseModel, Field, ValidationError

from app.config import settings


class EscalationDraft(BaseModel):
    message: str = Field(min_length=8, max_length=500)


class AlternativeDraft(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    duration_days: int = Field(ge=1, le=30)


def draft_alternative_title(task_title: str, role: str, department: str,
                            fallback_title: str | None = None,
                            fallback_days: int | None = None,
                            blocker_reason: str | None = None) -> dict[str, int | str]:
    """Suggest a bounded fallback task; a human HR reviewer must approve it."""
    fallback_by_department = {
        "IT": "Use an approved temporary device or access workaround",
        "Facilities": "Assign a temporary shared workspace or access arrangement",
        "HR": "Complete the approved manual process, then reconcile the HR system record",
    }
    fallback = {
        "title": fallback_title or fallback_by_department.get(department, f"Review and resolve: {task_title}"),
        "duration_days": max(1, min(fallback_days or 2, 30)),
    }
    if not settings.GEMINI_API_KEY:
        return fallback
    try:
        from google import genai

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=(
                "Suggest one practical, low-risk alternative onboarding task for HR to review. "
                "Do not claim work is complete, invent tools or approvals, or make a decision. "
                "Return JSON with title and estimated business days. "
                f"Task: {task_title}; role: {role}; department: {department}; "
                f"reported blocker: {blocker_reason or 'No additional blocker detail provided'}. "
                f"If the issue is resource availability, suggest a temporary, safe substitute. "
                f"For laptop or device shortages, prefer a configured loaner device. "
                f"If generation fails, use this approved fallback: {fallback['title']}."
            ),
            config={"response_mime_type": "application/json", "response_schema": AlternativeDraft},
        )
        return AlternativeDraft.model_validate_json(response.text or "").model_dump()
    except Exception:
        return fallback


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
