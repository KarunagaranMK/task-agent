import pytest
from pydantic import ValidationError

from app.services.planner import PlanSpec, TaskSpec, get_plan_for_role


def _spec(key: str, depends_on: list[str] | None = None, duration_days: int = 1) -> TaskSpec:
    return TaskSpec(key=key, title=key, team="IT", duration_days=duration_days, depends_on=depends_on or [])


def test_role_templates_are_valid_dependency_graphs():
    for role in ("default", "Data Analyst", "Software Engineer", "unknown"):
        plan = get_plan_for_role(role, hire_id=42)
        assert plan.tasks
        assert len({task.key for task in plan.tasks}) == len(plan.tasks)


def test_plan_rejects_unknown_dependency():
    with pytest.raises(ValidationError, match="Unknown dep"):
        PlanSpec(tasks=[_spec("A", ["missing"])])


def test_plan_rejects_duplicate_keys():
    with pytest.raises(ValidationError, match="unique"):
        PlanSpec(tasks=[_spec("A"), _spec("A")])


def test_plan_rejects_cycles():
    with pytest.raises(ValidationError, match="Cycle"):
        PlanSpec(tasks=[_spec("A", ["B"]), _spec("B", ["A"])])


def test_plan_rejects_invalid_duration_and_team():
    with pytest.raises(ValidationError, match="at least one"):
        _spec("A", duration_days=0)
    with pytest.raises(ValidationError, match="Invalid team"):
        TaskSpec(key="A", title="A", team="Payroll", duration_days=1)
