"""Administrative, audit, template, settings and experiment history APIs."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlmodel import Session, select

from app.auth import require_roles
from app.db.database import get_session
from app.domain.models import AppSetting, AuditEvent, ExperimentRun, Hire, OnboardingTemplate, SecurityAudit, User
from app.services.planner import PlanSpec, ROLE_TEMPLATES

router = APIRouter(tags=["administration"])


class TemplateSave(BaseModel):
    role_key: str = Field(min_length=1, max_length=120)
    tasks: list[dict[str, Any]] = Field(min_length=1, max_length=40)


class SettingsUpdate(BaseModel):
    stall_after_days: int = Field(ge=1, le=30)
    near_critical_margin: int = Field(ge=0, le=10)
    monitor_interval_minutes: int = Field(ge=1, le=1440)
    auto_worker_enabled: bool = False
    timezone: str = Field(default="Asia/Kolkata", min_length=1, max_length=80)
    holidays: list[date] = Field(default_factory=list, max_length=200)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        from app.services.clock import Clock
        Clock(timezone_name=value)
        return value


def _template_out(item: OnboardingTemplate) -> dict[str, Any]:
    return {"id": item.public_id, "role_key": item.role_key, "version": item.version,
            "tasks": json.loads(item.tasks_json), "active": item.active,
            "created_at": item.created_at.isoformat()}


def _public_actor(session: Session, actor: str) -> str:
    if not actor.startswith("user:"):
        return actor
    try:
        user_id = int(actor.removeprefix("user:"))
    except ValueError:
        return actor
    user = session.get(User, user_id)
    return f"user:{user.public_id}" if user else "user:unknown"


@router.get("/templates")
def list_templates(_viewer=Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)):
    saved = session.exec(select(OnboardingTemplate).order_by(OnboardingTemplate.role_key, OnboardingTemplate.version.desc())).all()
    latest = {item.role_key for item in saved}
    result = [_template_out(item) for item in saved]
    for role_key, tasks in ROLE_TEMPLATES.items():
        if role_key not in latest:
            result.append({"id": None, "role_key": role_key, "version": 1,
                           "tasks": tasks, "active": True, "created_at": None})
    return sorted(result, key=lambda item: (item["role_key"], -item["version"]))


@router.post("/templates", status_code=201)
def publish_template(data: TemplateSave, user=Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)):
    try:
        plan = PlanSpec.model_validate({"tasks": data.tasks})
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    prior = session.exec(select(OnboardingTemplate).where(OnboardingTemplate.role_key == data.role_key)
                         .order_by(OnboardingTemplate.version.desc())).first()
    version = (prior.version + 1) if prior else 1
    if prior:
        prior.active = False
        session.add(prior)
    item = OnboardingTemplate(role_key=data.role_key, version=version,
                              tasks_json=json.dumps([task.model_dump() for task in plan.tasks]), active=True)
    session.add(item)
    session.add(SecurityAudit(actor_id=user.id, action="template_published", target=data.role_key,
                              detail=f"version={version}; tasks={len(plan.tasks)}"))
    session.commit()
    session.refresh(item)
    return _template_out(item)


DEFAULT_SETTINGS = {
    "stall_after_days": "2", "near_critical_margin": "1",
    "monitor_interval_minutes": "15", "auto_worker_enabled": "false",
    "timezone": "Asia/Kolkata",
    "holidays": "[]",
}


@router.get("/settings")
def get_settings(_viewer=Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)):
    rows = session.exec(select(AppSetting)).all()
    values = {item.key: item.value for item in rows}
    return {key: values.get(key, value) for key, value in DEFAULT_SETTINGS.items()}


@router.put("/settings")
def update_settings(data: SettingsUpdate, user=Depends(require_roles("ADMIN")), session: Session = Depends(get_session)):
    values = data.model_dump()
    stored_values = {}
    for key, value in values.items():
        row = session.get(AppSetting, key)
        encoded = (json.dumps([item.isoformat() for item in value]) if key == "holidays"
                   else str(value).lower() if isinstance(value, bool) else str(value))
        stored_values[key] = encoded
        if row is None:
            row = AppSetting(key=key, value=encoded)
        else:
            row.value = encoded
            row.updated_at = datetime.utcnow()
        session.add(row)
    session.add(SecurityAudit(actor_id=user.id, action="settings_updated", detail=",".join(values)))
    session.commit()
    from app.services.scheduler import update_monitor_interval
    update_monitor_interval(data.monitor_interval_minutes)
    return stored_values


@router.get("/audit")
def get_audit(limit: int = Query(default=100, ge=1, le=500), search: str = "",
              _viewer=Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)):
    security = session.exec(select(SecurityAudit).order_by(SecurityAudit.created_at.desc()).limit(limit)).all()
    activity = session.exec(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)).all()
    rows = ([{"id": row.public_id, "kind": row.action,
              "actor": f"user:{(session.get(User, row.actor_id).public_id if session.get(User, row.actor_id) else 'unknown')}" if row.actor_id else "system",
              "target": row.target or "", "detail": row.detail, "created_at": row.created_at.isoformat(), "source": "security"}
             for row in security] +
            [{"id": row.public_id, "kind": row.level, "actor": _public_actor(session, row.actor_agent),
              "target": f"hire:{(session.get(Hire, row.hire_id).public_id if session.get(Hire, row.hire_id) else 'unknown')}",
              "detail": row.message, "created_at": row.created_at.isoformat(), "source": "workflow"}
             for row in activity])
    if search.strip():
        needle = search.strip().casefold()
        rows = [row for row in rows if needle in " ".join(str(value) for value in row.values()).casefold()]
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)[:limit]


@router.get("/experiments")
def experiment_history(limit: int = Query(default=20, ge=1, le=100),
                       _viewer=Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)):
    rows = session.exec(select(ExperimentRun).order_by(ExperimentRun.created_at.desc()).limit(limit)).all()
    return [{"id": row.public_id, "parameters": json.loads(row.parameters_json),
             "result": json.loads(row.result_json), "created_at": row.created_at.isoformat()} for row in rows]


@router.post("/admin/clock")
def set_demo_clock(day: int = Query(ge=0, le=365), user=Depends(require_roles("ADMIN")), session: Session = Depends(get_session)):
    from app.domain.models import SimState
    state = session.exec(select(SimState)).first()
    if state is None:
        state = SimState(current_day=day)
    else:
        state.current_day = day
    session.add(state)
    session.add(SecurityAudit(actor_id=user.id, action="demo_clock_set", target=f"day:{day}"))
    session.commit()
    return {"current_day": state.current_day}
