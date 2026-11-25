"""Login, short-lived access JWTs, and rotated refresh cookies."""
from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID
from threading import Lock
from typing import Callable

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select, update

from app.config import settings
from app.db.database import get_session
from app.domain.models import AppSetting, MailOutbox, OneTimeToken, RefreshToken, SecurityAudit, User

router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])
mail_router = APIRouter(prefix="/dev", tags=["development"])
_LOGIN_ATTEMPTS: dict[tuple[str, str], list[float]] = {}
_LOGIN_IP_ATTEMPTS: dict[str, list[float]] = {}
_LOGIN_ACCOUNT_ATTEMPTS: dict[str, list[float]] = {}
_LOGIN_ATTEMPTS_LOCK = Lock()
_LOGIN_ATTEMPTS_WINDOW = 900
_LOGIN_PAIR_LIMIT = 20
_LOGIN_IP_LIMIT = 100
_LOGIN_ACCOUNT_LIMIT = 60
_LOGIN_ATTEMPT_COUNT = 0
_PUBLIC_ATTEMPTS: dict[tuple[str, str], list[float]] = {}
_PUBLIC_ATTEMPTS_LOCK = Lock()
_PUBLIC_ATTEMPTS_WINDOW = 900
_PUBLIC_ENDPOINT_LIMITS = {"password_forgot": 10, "password_reset": 30, "accept_invite": 30}
_PUBLIC_ATTEMPT_COUNT = 0
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
dummy_password_hash = password_hasher.hash("not-a-real-user-password")
bearer = HTTPBearer(auto_error=False)


def _record_login_attempt(client_ip: str, email: str, now_seconds: float) -> None:
    global _LOGIN_ATTEMPT_COUNT
    account = email.strip().lower()
    pair_key = (client_ip, account)
    buckets = (
        (_LOGIN_ATTEMPTS, pair_key, _LOGIN_PAIR_LIMIT),
        (_LOGIN_IP_ATTEMPTS, client_ip, _LOGIN_IP_LIMIT),
        (_LOGIN_ACCOUNT_ATTEMPTS, account, _LOGIN_ACCOUNT_LIMIT),
    )
    with _LOGIN_ATTEMPTS_LOCK:
        current: list[tuple[dict, object, list[float], int]] = []
        for bucket, key, limit in buckets:
            recent = [stamp for stamp in bucket.get(key, []) if now_seconds - stamp < _LOGIN_ATTEMPTS_WINDOW]
            if len(recent) >= limit:
                raise HTTPException(status_code=429, detail="Too many sign-in attempts. Try again later.")
            current.append((bucket, key, recent, limit))
        for bucket, key, recent, _limit in current:
            recent.append(now_seconds)
            bucket[key] = recent
        _LOGIN_ATTEMPT_COUNT += 1
        if _LOGIN_ATTEMPT_COUNT % 128 == 0:
            for bucket, _key, _limit in buckets:
                expired = [key for key, values in bucket.items() if not values or now_seconds - values[-1] >= _LOGIN_ATTEMPTS_WINDOW]
                for key in expired:
                    bucket.pop(key, None)


def _record_public_attempt(endpoint: str, client_ip: str, now_seconds: float) -> None:
    """Bound anonymous recovery and invite traffic per endpoint and client IP."""
    global _PUBLIC_ATTEMPT_COUNT
    limit = _PUBLIC_ENDPOINT_LIMITS[endpoint]
    key = (endpoint, client_ip)
    with _PUBLIC_ATTEMPTS_LOCK:
        recent = [stamp for stamp in _PUBLIC_ATTEMPTS.get(key, []) if now_seconds - stamp < _PUBLIC_ATTEMPTS_WINDOW]
        if len(recent) >= limit:
            raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
        recent.append(now_seconds)
        _PUBLIC_ATTEMPTS[key] = recent
        _PUBLIC_ATTEMPT_COUNT += 1
        if _PUBLIC_ATTEMPT_COUNT % 128 == 0:
            expired = [bucket_key for bucket_key, values in _PUBLIC_ATTEMPTS.items()
                       if not values or now_seconds - values[-1] >= _PUBLIC_ATTEMPTS_WINDOW]
            for bucket_key in expired:
                _PUBLIC_ATTEMPTS.pop(bucket_key, None)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    name: str
    role: str
    team: str | None = None
    must_change_password: bool = False
    is_active: bool = True


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=UUID(user.public_id), email=user.email, name=user.name, role=user.role,
        team=user.team, must_change_password=user.must_change_password, is_active=user.is_active,
    )


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ForgotRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class TokenPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=10, max_length=256)


class InviteRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=120)
    role: str
    team: str | None = None


class ProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class PreferenceUpdate(BaseModel):
    in_app: bool = True
    email: bool = False


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


def _audit(session: Session, action: str, actor_id: int | None = None, target: str | None = None, detail: str = "") -> None:
    session.add(SecurityAudit(actor_id=actor_id, action=action, target=target, detail=detail[:500]))


def in_app_notifications_enabled(session: Session, user: User | int) -> bool:
    user_id = user if isinstance(user, int) else user.id
    item = session.get(AppSetting, f"notification_preferences:{user_id}")
    if item is None:
        return True
    try:
        return bool(json.loads(item.value).get("in_app", True))
    except (ValueError, AttributeError):
        return True


def _issue_one_time_token(session: Session, user: User, purpose: str) -> str:
    raw = secrets.token_urlsafe(32)
    session.add(OneTimeToken(user_id=user.id, token_hash=_token_digest(raw), purpose=purpose,
                             expires_at=datetime.utcnow() + timedelta(minutes=30)))
    link = f"http://localhost:5173/{'accept-invite' if purpose == 'invite' else 'reset-password'}?token={raw}"
    session.add(MailOutbox(recipient=user.email, subject="Set up your OnboardIQ account" if purpose == "invite" else "Reset your OnboardIQ password",
                           body=f"Use this single-use link within 30 minutes: {link}"))
    return raw


def hash_password(password: str) -> str:
    if len(password) < 10:
        raise ValueError("Password must contain at least 10 characters.")
    return password_hasher.hash(password)


def _token_digest(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _burn_password_check(password: str) -> None:
    try:
        password_hasher.verify(dummy_password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        pass


def _access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=15), "type": "access"},
        settings.JWT_SECRET,
        algorithm="HS256",
    )


def _set_auth_cookies(response: Response, refresh_token: str, csrf_token: str) -> None:
    response.set_cookie(
        "refresh_token", refresh_token, httponly=True, secure=settings.COOKIE_SECURE,
        samesite="lax", path="/", max_age=7 * 24 * 60 * 60,
    )
    response.set_cookie(
        "csrf_token", csrf_token, httponly=False, secure=settings.COOKIE_SECURE,
        samesite="lax", path="/", max_age=7 * 24 * 60 * 60,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("refresh_token", path="/", secure=settings.COOKIE_SECURE, httponly=True, samesite="lax")
    response.delete_cookie("csrf_token", path="/", secure=settings.COOKIE_SECURE, samesite="lax")


def _check_csrf(request: Request, header_token: str | None) -> None:
    cookie_token = request.cookies.get("csrf_token")
    origin = request.headers.get("origin", "")
    allowed_origins = set(settings.allowed_frontend_origins)
    if not origin or origin not in allowed_origins or not cookie_token or not header_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    if not secrets.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "access":
            raise unauthorized
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = session.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_roles(*roles: str) -> Callable:
    def check(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user
    return check


@router.post("/login", response_model=LoginOut)
def login(data: LoginRequest, request: Request, response: Response, session: Session = Depends(get_session)) -> LoginOut:
    now_seconds = time.monotonic()
    client_ip = request.client.host if request.client else "unknown"
    throttle_key = (client_ip, data.email.strip().lower())
    recent = [stamp for stamp in _LOGIN_ATTEMPTS.get(throttle_key, []) if now_seconds - stamp < 900]
    if len(recent) >= 20:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts. Try again later.")
    recent.append(now_seconds)
    _LOGIN_ATTEMPTS[throttle_key] = recent
    user = session.exec(select(User).where(User.email == data.email.strip().lower())).first()
    if user is None:
        _burn_password_check(data.password)
        _audit(session, "login_failed", target=data.email.strip().lower())
        session.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")
    now = datetime.utcnow()
    if not user.is_active or (user.locked_until is not None and user.locked_until > now):
        _burn_password_check(data.password)
        _audit(session, "login_failed", actor_id=user.id, target=user.email)
        session.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")
    try:
        password_hasher.verify(user.password_hash, data.password)
    except (VerifyMismatchError, InvalidHashError):
        user.failed_logins += 1
        if user.failed_logins >= 5:
            user.locked_until = now + timedelta(minutes=15)
            user.failed_logins = 0
            _audit(session, "account_locked", actor_id=user.id, target=user.email)
        _audit(session, "login_failed", actor_id=user.id, target=user.email)
        session.add(user)
        session.commit()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.failed_logins = 0
    user.locked_until = None
    session.add(user)
    _audit(session, "login_succeeded", actor_id=user.id, target=user.email)
    raw_refresh = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    session.add(RefreshToken(
        user_id=user.id, family_id=secrets.token_urlsafe(18), token_hash=_token_digest(raw_refresh),
        expires_at=now + timedelta(days=7),
    ))
    session.commit()
    _set_auth_cookies(response, raw_refresh, csrf)
    return LoginOut(access_token=_access_token(user), user=_user_out(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(user)


@router.put("/profile", response_model=UserOut)
def update_profile(data: ProfileUpdate, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> UserOut:
    user.name = data.name.strip()
    session.add(user)
    _audit(session, "profile_updated", actor_id=user.id, target=user.email)
    session.commit()
    session.refresh(user)
    return _user_out(user)


@router.get("/preferences")
def get_preferences(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, bool]:
    item = session.get(AppSetting, f"notification_preferences:{user.id}")
    if item is None:
        return {"in_app": True, "email": False}
    try:
        values = json.loads(item.value)
        return {"in_app": bool(values.get("in_app", True)), "email": bool(values.get("email", False))}
    except (ValueError, AttributeError):
        return {"in_app": True, "email": False}


@router.put("/preferences")
def update_preferences(data: PreferenceUpdate, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, bool]:
    key = f"notification_preferences:{user.id}"
    item = session.get(AppSetting, key) or AppSetting(key=key, value="{}")
    item.value = json.dumps(data.model_dump(), sort_keys=True)
    item.updated_at = datetime.utcnow()
    session.add(item)
    _audit(session, "notification_preferences_updated", actor_id=user.id, target=user.email)
    session.commit()
    return data.model_dump()


@router.post("/refresh", response_model=LoginOut)
def refresh(
    request: Request,
    response: Response,
    x_csrf_token: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> LoginOut:
    _check_csrf(request, x_csrf_token)
    raw = request.cookies.get("refresh_token")
    if not raw:
        raise HTTPException(status_code=401, detail="Refresh token is invalid")
    old = session.exec(select(RefreshToken).where(RefreshToken.token_hash == _token_digest(raw))).first()
    if old is None:
        raise HTTPException(status_code=401, detail="Refresh token is invalid")
    if old.revoked_at is not None:
        session.exec(update(RefreshToken).where(RefreshToken.family_id == old.family_id).values(revoked_at=datetime.utcnow()))
        session.commit()
        raise HTTPException(status_code=401, detail="Refresh token is invalid")
    now = datetime.utcnow()
    user = session.get(User, old.user_id)
    if old.expires_at <= now or user is None or not user.is_active:
        old.revoked_at = now
        session.add(old)
        session.commit()
        raise HTTPException(status_code=401, detail="Refresh token is invalid")

    new_raw = secrets.token_urlsafe(48)
    new = RefreshToken(
        user_id=user.id, family_id=old.family_id, token_hash=_token_digest(new_raw),
        expires_at=now + timedelta(days=7),
    )
    session.add(new)
    session.flush()
    old.revoked_at = now
    old.replaced_by = new.id
    session.add(old)
    session.commit()
    _set_auth_cookies(response, new_raw, secrets.token_urlsafe(32))
    return LoginOut(access_token=_access_token(user), user=_user_out(user))


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    x_csrf_token: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    _check_csrf(request, x_csrf_token)
    raw = request.cookies.get("refresh_token")
    if raw:
        token = session.exec(select(RefreshToken).where(RefreshToken.token_hash == _token_digest(raw))).first()
        if token and token.revoked_at is None:
            token.revoked_at = datetime.utcnow()
            session.add(token)
            _audit(session, "logout", actor_id=token.user_id)
            session.commit()
    _clear_auth_cookies(response)
    return {"status": "logged_out"}


@router.post("/logout-all")
def logout_all(
    request: Request,
    response: Response,
    x_csrf_token: str | None = Header(default=None),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    _check_csrf(request, x_csrf_token)
    session.exec(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=datetime.utcnow()))
    _audit(session, "logout_all", actor_id=user.id)
    session.commit()
    _clear_auth_cookies(response)
    return {"status": "logged_out_everywhere"}


@router.post("/password/forgot")
def forgot_password(request: Request, data: ForgotRequest, session: Session = Depends(get_session)) -> dict[str, str]:
    _record_public_attempt("password_forgot", request.client.host if request.client else "unknown", time.time())
    user = session.exec(select(User).where(User.email == data.email.strip().lower(), User.is_active == True)).first()  # noqa: E712
    if user is not None:
        _issue_one_time_token(session, user, "password_reset")
        _audit(session, "password_reset_requested", actor_id=user.id)
        session.commit()
    return {"message": "If an account matches that address, a recovery link has been sent."}


@router.post("/password/reset")
def reset_password(request: Request, data: TokenPasswordRequest, session: Session = Depends(get_session)) -> dict[str, str]:
    _record_public_attempt("password_reset", request.client.host if request.client else "unknown", time.time())
    token = session.exec(select(OneTimeToken).where(OneTimeToken.token_hash == _token_digest(data.token), OneTimeToken.purpose == "password_reset")).first()
    now = datetime.utcnow()
    if token is None or token.used_at is not None or token.expires_at <= now:
        raise HTTPException(status_code=400, detail="Recovery link is invalid or expired")
    user = session.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Recovery link is invalid or expired")
    token.used_at = now
    user.password_hash = hash_password(data.password)
    user.must_change_password = False
    session.add(token)
    session.add(user)
    session.exec(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=now))
    _audit(session, "password_reset", actor_id=user.id)
    session.commit()
    return {"status": "password_updated"}


@router.post("/password/change")
def change_password(data: PasswordChange, user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> dict[str, str]:
    old_password = data.current_password
    new_password = data.new_password
    try:
        password_hasher.verify(user.password_hash, old_password)
    except (VerifyMismatchError, InvalidHashError):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    session.add(user)
    session.exec(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=datetime.utcnow()))
    _audit(session, "password_changed", actor_id=user.id)
    session.commit()
    return {"status": "password_updated"}


@router.post("/accept-invite")
def accept_invite(request: Request, data: TokenPasswordRequest, session: Session = Depends(get_session)) -> dict[str, str]:
    _record_public_attempt("accept_invite", request.client.host if request.client else "unknown", time.time())
    token = session.exec(select(OneTimeToken).where(OneTimeToken.token_hash == _token_digest(data.token), OneTimeToken.purpose == "invite")).first()
    now = datetime.utcnow()
    if token is None or token.used_at is not None or token.expires_at <= now:
        raise HTTPException(status_code=400, detail="Invitation link is invalid or expired")
    user = session.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Invitation link is invalid or expired")
    token.used_at = now
    user.password_hash = hash_password(data.password)
    user.must_change_password = False
    session.add(token)
    session.add(user)
    _audit(session, "invite_accepted", actor_id=user.id)
    session.commit()
    return {"status": "account_activated"}


@users_router.get("")
def list_users(_admin: User = Depends(require_roles("ADMIN")), session: Session = Depends(get_session)) -> list[UserOut]:
    return [_user_out(user) for user in session.exec(select(User).order_by(User.created_at.desc())).all()]


@users_router.get("/managers")
def list_managers(_viewer: User = Depends(require_roles("ADMIN", "HR")), session: Session = Depends(get_session)) -> list[UserOut]:
    managers = session.exec(select(User).where(User.role == "MANAGER", User.is_active.is_(True)).order_by(User.name)).all()
    return [_user_out(user) for user in managers]


@users_router.post("/invite", response_model=UserOut, status_code=201)
def invite_user(data: InviteRequest, admin: User = Depends(require_roles("ADMIN")), session: Session = Depends(get_session)) -> UserOut:
    email = data.email.strip().lower()
    if data.role not in {"ADMIN", "HR", "MANAGER", "IT_STAFF", "NEW_HIRE"}:
        raise HTTPException(status_code=422, detail="Unsupported role")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    user = User(email=email, name=data.name.strip(), role=data.role, team=data.team, password_hash=hash_password(secrets.token_urlsafe(24)), must_change_password=True)
    session.add(user)
    session.flush()
    _issue_one_time_token(session, user, "invite")
    _audit(session, "user_invited", actor_id=admin.id, target=email, detail=data.role)
    session.commit()
    session.refresh(user)
    return _user_out(user)


@users_router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: UUID, data: dict, admin: User = Depends(require_roles("ADMIN")), session: Session = Depends(get_session)) -> UserOut:
    user = session.exec(select(User).where(User.public_id == str(user_id))).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if "role" in data:
        role = str(data["role"])
        if role not in {"ADMIN", "HR", "MANAGER", "IT_STAFF", "NEW_HIRE"}:
            raise HTTPException(status_code=422, detail="Unsupported role")
        if user.role != role:
            _audit(session, "role_changed", actor_id=admin.id, target=user.email, detail=f"{user.role}->{role}")
        user.role = role
    if "team" in data:
        user.team = data["team"]
    if "is_active" in data:
        user.is_active = bool(data["is_active"])
        if not user.is_active:
            session.exec(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=datetime.utcnow()))
    session.add(user)
    _audit(session, "user_updated", actor_id=admin.id, target=user.email, detail=",".join(data.keys()))
    session.commit()
    session.refresh(user)
    return _user_out(user)


@users_router.delete("/{user_id}", response_model=UserOut)
def deactivate_user(user_id: UUID, admin: User = Depends(require_roles("ADMIN")), session: Session = Depends(get_session)) -> UserOut:
    user = session.exec(select(User).where(User.public_id == str(user_id))).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    session.add(user)
    session.exec(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=datetime.utcnow()))
    _audit(session, "user_deactivated", actor_id=admin.id, target=user.email)
    session.commit()
    session.refresh(user)
    return _user_out(user)


@mail_router.get("/mail")
def get_dev_mail(_admin: User = Depends(require_roles("ADMIN")), session: Session = Depends(get_session)) -> list[dict[str, str]]:
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=404, detail="Not found")
    return [{"id": item.public_id, "recipient": item.recipient, "subject": item.subject,
             "body": item.body, "created_at": item.created_at.isoformat()}
            for item in session.exec(select(MailOutbox).order_by(MailOutbox.created_at.desc())).all()]
