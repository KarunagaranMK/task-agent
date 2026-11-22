"""
Plan generator: creates a task DAG for a hire based on role template.
LLM used optionally to add role-specific tasks; falls back to template on any error.
"""
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, field_validator
import json


class TaskSpec(BaseModel):
    key: str
    title: str
    team: str
    duration_days: int
    depends_on: List[str] = []
    needs_approval: bool = False
    fallback_title: Optional[str] = None
    fallback_days: Optional[int] = None

    @field_validator("team")
    @classmethod
    def validate_team(cls, v: str) -> str:
        if v not in ("IT", "HR", "Facilities"):
            raise ValueError(f"Invalid team: {v}")
        return v


class PlanSpec(BaseModel):
    tasks: List[TaskSpec]

    @field_validator("tasks")
    @classmethod
    def validate_dag(cls, tasks: List[TaskSpec]) -> List[TaskSpec]:
        keys = {t.key for t in tasks}
        for t in tasks:
            for dep in t.depends_on:
                if dep not in keys:
                    raise ValueError(f"Unknown dep '{dep}' in task '{t.key}'")
            if t.key in t.depends_on:
                raise ValueError(f"Self-dependency in task '{t.key}'")
        return tasks


ROLE_TEMPLATES: Dict[str, List[Dict[str, Any]]] = {
    "default": [
        {"key": "it:laptop", "title": "Provision Laptop", "team": "IT",
         "duration_days": 3, "depends_on": [], "needs_approval": False,
         "fallback_title": "Issue Loaner Laptop", "fallback_days": 1},
        {"key": "it:accounts", "title": "Create AD/Email Accounts", "team": "IT",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "it:vpn", "title": "VPN & Security Setup", "team": "IT",
         "duration_days": 1, "depends_on": ["it:accounts"], "needs_approval": False},
        {"key": "hr:contracts", "title": "Sign Employment Contracts", "team": "HR",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "hr:payroll", "title": "Enroll in Payroll", "team": "HR",
         "duration_days": 1, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "hr:training", "title": "Assign Compliance Training", "team": "HR",
         "duration_days": 2, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "facilities:badge", "title": "Issue Security Badge", "team": "Facilities",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "facilities:desk", "title": "Assign Desk & Equipment", "team": "Facilities",
         "duration_days": 1, "depends_on": ["facilities:badge"], "needs_approval": False},
    ],
    "Data Analyst": [
        {"key": "it:laptop", "title": "Provision Laptop (High RAM)", "team": "IT",
         "duration_days": 3, "depends_on": [], "needs_approval": False,
         "fallback_title": "Issue Loaner Laptop", "fallback_days": 1},
        {"key": "it:accounts", "title": "Create AD/Email Accounts", "team": "IT",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "it:vpn", "title": "VPN & Security Setup", "team": "IT",
         "duration_days": 1, "depends_on": ["it:accounts"], "needs_approval": False},
        {"key": "it:powerbi", "title": "Power BI License & Access", "team": "IT",
         "duration_days": 1, "depends_on": ["it:accounts"], "needs_approval": True},
        {"key": "it:data_access", "title": "Data Warehouse Access", "team": "IT",
         "duration_days": 1, "depends_on": ["it:powerbi"], "needs_approval": True},
        {"key": "hr:contracts", "title": "Sign Employment Contracts", "team": "HR",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "hr:payroll", "title": "Enroll in Payroll", "team": "HR",
         "duration_days": 1, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "hr:training", "title": "Assign Compliance + Data Privacy Training", "team": "HR",
         "duration_days": 2, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "facilities:badge", "title": "Issue Security Badge", "team": "Facilities",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "facilities:desk", "title": "Assign Desk & Analytics Workstation",
         "team": "Facilities", "duration_days": 1, "depends_on": ["facilities:badge"],
         "needs_approval": False},
    ],
    "Software Engineer": [
        {"key": "it:laptop", "title": "Provision Dev Laptop", "team": "IT",
         "duration_days": 2, "depends_on": [], "needs_approval": False,
         "fallback_title": "Issue Loaner Laptop", "fallback_days": 1},
        {"key": "it:accounts", "title": "Create AD/Email/GitHub Accounts", "team": "IT",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "it:vpn", "title": "VPN & Security Setup", "team": "IT",
         "duration_days": 1, "depends_on": ["it:accounts"], "needs_approval": False},
        {"key": "it:repo_access", "title": "GitHub/GitLab Repo Access", "team": "IT",
         "duration_days": 1, "depends_on": ["it:accounts"], "needs_approval": True},
        {"key": "hr:contracts", "title": "Sign Employment Contracts", "team": "HR",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "hr:payroll", "title": "Enroll in Payroll", "team": "HR",
         "duration_days": 1, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "hr:training", "title": "Assign Security & Compliance Training", "team": "HR",
         "duration_days": 2, "depends_on": ["hr:contracts"], "needs_approval": False},
        {"key": "facilities:badge", "title": "Issue Security Badge", "team": "Facilities",
         "duration_days": 1, "depends_on": [], "needs_approval": False},
        {"key": "facilities:desk", "title": "Assign Desk & Monitors", "team": "Facilities",
         "duration_days": 1, "depends_on": ["facilities:badge"], "needs_approval": False},
    ],
}


def get_plan_for_role(role: str, hire_id: int) -> PlanSpec:
    """Return validated task DAG for a role, falling back to default template."""
    template = ROLE_TEMPLATES.get(role, ROLE_TEMPLATES["default"])
    tasks = [TaskSpec(**t) for t in template]
    return PlanSpec(tasks=tasks)


def try_llm_plan(role: str, hire_id: int, api_key: Optional[str] = None) -> PlanSpec:
    """Try Gemini LLM for extra tasks; fall back to template on any error."""
    base_plan = get_plan_for_role(role, hire_id)
    if not api_key:
        return base_plan
    try:
        import google.genai as genai
        from app.config import settings

        client = genai.Client(api_key=api_key)
        prompt = (
            f"You are an HR onboarding specialist. For a new hire with role '{role}', "
            "list up to 2 additional onboarding tasks beyond the standard ones. "
            'Return JSON only: {"extra_tasks": [{"key": "...", "title": "...", '
            '"team": "IT|HR|Facilities", "duration_days": N, "depends_on": [], '
            '"needs_approval": false}]}'
        )
        response = client.models.generate_content(model=settings.GEMINI_MODEL, contents=prompt)
        data = json.loads(response.text.strip().strip("```json").strip("```"))
        for extra in data.get("extra_tasks", [])[:2]:
            try:
                spec = TaskSpec(**extra)
                # Only add if key doesn't already exist
                existing_keys = {t.key for t in base_plan.tasks}
                if spec.key not in existing_keys:
                    base_plan.tasks.append(spec)
            except Exception:
                pass
        return PlanSpec(tasks=base_plan.tasks)
    except Exception:
        return base_plan
