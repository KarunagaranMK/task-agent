"""Role-filtered server-sent events using short-lived single-use tickets."""
from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, update
from sqlmodel import Session, select

from app.auth import get_current_user, in_app_notifications_enabled
from app.db.database import commit_now, get_session
from app.domain.models import Hire, Notification, StreamTicket, Task, User

router = APIRouter(prefix="/events", tags=["events"])


@dataclass(frozen=True)
class StreamPrincipal:
    """Immutable identity snapshot safe to retain for a long-lived stream."""

    id: int
    role: str
    team: str | None


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/ticket")
def create_stream_ticket(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, str | int]:
    raw = secrets.token_urlsafe(32)
    latest = session.exec(select(func.max(Notification.id))).one() or 0
    session.add(StreamTicket(
        user_id=user.id,
        token_hash=_digest(raw),
        last_event_id=int(latest),
        expires_at=datetime.utcnow() + timedelta(seconds=60),
    ))
    session.commit()
    return {"ticket": raw, "expires_in": 60}


def _role_filter(session: Session, user: StreamPrincipal, after_id: int) -> tuple[list[Notification], int]:
    query = select(Notification).where(Notification.id > after_id).order_by(Notification.id)
    notifications = session.exec(query).all()
    if not in_app_notifications_enabled(session, user.id):
        return [], max((item.id or after_id for item in notifications), default=after_id)
    visible: list[Notification] = []
    cursor = after_id
    for item in notifications:
        cursor = max(cursor, item.id or cursor)
        if user.role == "ADMIN":
            if item.for_role == "ADMIN":
                visible.append(item)
        elif user.role == "HR":
            if item.for_role == "HR":
                visible.append(item)
        elif user.role == "IT_STAFF":
            team_name = "Facilities" if (user.team or "").lower() == "facilities" else "IT"
            if item.for_role == team_name:
                visible.append(item)
    return visible, cursor


@router.get("/stream")
async def event_stream(
    request: Request,
    ticket: str = Query(min_length=20, max_length=256),
    max_events: int = Query(default=0, ge=0, le=100),
    session: Session = Depends(get_session),
):
    token = session.exec(select(StreamTicket).where(StreamTicket.token_hash == _digest(ticket))).first()
    now = datetime.utcnow()
    if token is None or token.used_at is not None or token.expires_at <= now:
        raise HTTPException(status_code=401, detail="Stream ticket is invalid or expired")
    updated = session.exec(
        update(StreamTicket)
        .where(StreamTicket.id == token.id, StreamTicket.used_at.is_(None), StreamTicket.expires_at > now)
        .values(used_at=now)
    )
    if updated.rowcount != 1:
        session.rollback()
        raise HTTPException(status_code=401, detail="Stream ticket is invalid or expired")
    user = session.get(User, token.user_id)
    if user is None or not user.is_active:
        commit_now(session)
        raise HTTPException(status_code=401, detail="Stream ticket is invalid or expired")
    principal = StreamPrincipal(id=user.id, role=user.role, team=user.team)
    cursor = token.last_event_id
    # Consume the single-use token before the stream opens; otherwise the request
    # transaction would remain pending until the client disconnects.
    commit_now(session)

    async def stream() -> AsyncIterator[str]:
        nonlocal cursor
        yield "event: connected\ndata: {}\n\n"
        if max_events:
            items, cursor = _role_filter(session, principal, cursor)
            for item in items[:max_events]:
                data = json.dumps({
                    "id": item.public_id,
                    "for_role": item.for_role,
                    "message": item.message,
                    "hire_id": _public_hire_id(session, item),
                    "task_id": _public_task_id(session, item),
                    "created_at": item.created_at.isoformat(),
                }, separators=(",", ":"))
                yield f"id: {item.id}\nevent: notification\ndata: {data}\n\n"
            return
        while not await request.is_disconnected():
            items, next_cursor = _role_filter(session, principal, cursor)
            cursor = next_cursor
            for item in items:
                cursor = max(cursor, item.id or cursor)
                data = json.dumps({
                    "id": item.public_id,
                    "for_role": item.for_role,
                    "message": item.message,
                    "hire_id": _public_hire_id(session, item),
                    "task_id": _public_task_id(session, item),
                    "created_at": item.created_at.isoformat(),
                }, separators=(",", ":"))
                yield f"id: {item.id}\nevent: notification\ndata: {data}\n\n"
            yield ": keep-alive\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


def _public_hire_id(session: Session, notification: Notification) -> str | None:
    hire = session.get(Hire, notification.hire_id) if notification.hire_id is not None else None
    return hire.public_id if hire else None


def _public_task_id(session: Session, notification: Notification) -> str | None:
    task = session.get(Task, notification.task_id) if notification.task_id is not None else None
    return task.public_id if task else None
