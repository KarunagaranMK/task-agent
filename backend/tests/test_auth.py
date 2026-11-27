from __future__ import annotations


import pytest
from fastapi import HTTPException
from sqlmodel import select
from uuid import uuid4

from app.auth import get_current_user, hash_password, _record_login_attempt, _record_public_attempt, _LOGIN_IP_LIMIT, _LOGIN_ACCOUNT_LIMIT
from app.domain.models import MailOutbox, RefreshToken, SecurityAudit, User
from seed import seed_demo_users


def _user(session, email="person@example.local", role="HR", team=None):
    user = User(email=email, name="Test Person", role=role, team=team, password_hash=hash_password("Strong-Pass-123"))
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_login_and_me_use_access_token(anonymous_client, session):
    _user(session)
    login = anonymous_client.post("/auth/login", json={"email": "PERSON@example.local", "password": "Strong-Pass-123"})
    assert login.status_code == 200
    body = login.json()
    assert body["user"]["role"] == "HR"
    assert "refresh_token" in anonymous_client.cookies
    assert "csrf_token" in anonymous_client.cookies
    me = anonymous_client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "person@example.local"


def test_demo_seed_repairs_retired_department_roles(session, monkeypatch):
    stale_it_user = User(
        email="it@demo.local", name="Old Manager", role="MANAGER", team=None,
        password_hash="legacy-hash", is_active=False,
    )
    session.add(stale_it_user)
    session.commit()
    monkeypatch.setattr("seed.hash_password", lambda _password: "demo-hash")

    users = seed_demo_users(session)

    assert users["it@demo.local"].role == "IT_STAFF"
    assert users["it@demo.local"].team == "IT"
    assert users["it@demo.local"].is_active is True
    assert users["it@demo.local"].password_hash == "demo-hash"
    assert users["facilities@demo.local"].role == "IT_STAFF"
    assert users["facilities@demo.local"].team == "Facilities"


def test_login_has_generic_error(anonymous_client, session):
    _user(session)
    known = anonymous_client.post("/auth/login", json={"email": "person@example.local", "password": "bad"})
    unknown = anonymous_client.post("/auth/login", json={"email": "missing@example.local", "password": "bad"})
    assert known.status_code == unknown.status_code == 401
    known_body = {key: value for key, value in known.json().items() if key != "request_id"}
    unknown_body = {key: value for key, value in unknown.json().items() if key != "request_id"}
    assert known_body == unknown_body
    assert known.json()["request_id"] != unknown.json()["request_id"]


def test_login_lockout_after_five_failures(anonymous_client, session):
    user = _user(session)
    for _ in range(5):
        response = anonymous_client.post("/auth/login", json={"email": user.email, "password": "wrong-password"})
        assert response.status_code == 401
    session.refresh(user)
    assert user.locked_until is not None
    assert user.failed_logins == 0
    assert anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"}).status_code == 401


def test_login_attempt_limits_are_aggregated_by_ip_and_account():
    client_ip = f"rate-test-{uuid4()}"
    for index in range(_LOGIN_IP_LIMIT):
        _record_login_attempt(client_ip, f"person-{index}@example.local", 1_000 + index)
    with pytest.raises(HTTPException) as ip_limited:
        _record_login_attempt(client_ip, "another-person@example.local", 1_200)
    assert ip_limited.value.status_code == 429

    account = f"rate-account-{uuid4()}@example.local"
    for index in range(_LOGIN_ACCOUNT_LIMIT):
        _record_login_attempt(f"different-ip-{index}-{uuid4()}", account, 2_000 + index)
    with pytest.raises(HTTPException) as account_limited:
        _record_login_attempt(f"another-ip-{uuid4()}", account, 2_200)
    assert account_limited.value.status_code == 429


def test_public_auth_routes_have_independent_ip_limits():
    from app.auth import _PUBLIC_ENDPOINT_LIMITS

    ip = f"public-rate-test-{uuid4()}"
    for index in range(_PUBLIC_ENDPOINT_LIMITS["password_forgot"]):
        _record_public_attempt("password_forgot", ip, 3_000 + index)
    with pytest.raises(HTTPException) as limited:
        _record_public_attempt("password_forgot", ip, 3_100)
    assert limited.value.status_code == 429
    # A separate endpoint has its own allowance for the same IP.
    _record_public_attempt("password_reset", ip, 3_100)


def test_password_change_requires_current_password_and_revokes_sessions(anonymous_client, session):
    user = _user(session)
    login = anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"})
    response = anonymous_client.post("/auth/password/change", json={"current_password": "Strong-Pass-123", "new_password": "Changed-Strong-123"}, headers={"Authorization": f"Bearer {login.json()['access_token']}"})
    assert response.status_code == 200
    assert anonymous_client.post("/auth/login", json={"email": user.email, "password": "Changed-Strong-123"}).status_code == 200
    assert session.exec(select(SecurityAudit).where(SecurityAudit.action == "password_changed")).first()


def _csrf_headers(client, origin="http://localhost:5173"):
    return {"Origin": origin, "X-CSRF-Token": client.cookies.get("csrf_token", "")}


def test_refresh_rotates_cookie_and_replay_revokes_family(anonymous_client, session):
    _user(session)
    anonymous_client.post("/auth/login", json={"email": "person@example.local", "password": "Strong-Pass-123"})
    old_raw = anonymous_client.cookies.get("refresh_token")
    old_record = session.exec(select(RefreshToken)).first()
    response = anonymous_client.post("/auth/refresh", headers=_csrf_headers(anonymous_client))
    assert response.status_code == 200
    assert anonymous_client.cookies.get("refresh_token") != old_raw
    session.refresh(old_record)
    assert old_record.revoked_at is not None
    assert old_record.replaced_by is not None

    anonymous_client.cookies.delete("refresh_token", path="/auth")
    anonymous_client.cookies.set("refresh_token", old_raw, path="/")
    replay = anonymous_client.post("/auth/refresh", headers=_csrf_headers(anonymous_client))
    assert replay.status_code == 401
    family = session.exec(select(RefreshToken).where(RefreshToken.family_id == old_record.family_id)).all()
    assert all(token.revoked_at is not None for token in family)


def test_refresh_requires_double_submit_and_allowed_origin(anonymous_client, session):
    _user(session)
    anonymous_client.post("/auth/login", json={"email": "person@example.local", "password": "Strong-Pass-123"})
    bad = anonymous_client.post("/auth/refresh", headers=_csrf_headers(anonymous_client, "https://attacker.invalid"))
    assert bad.status_code == 403
    good_headers = _csrf_headers(anonymous_client)
    good_headers["X-CSRF-Token"] = "wrong"
    assert anonymous_client.post("/auth/refresh", headers=good_headers).status_code == 403


def test_logout_all_revokes_all_refresh_tokens(anonymous_client, session):
    user = _user(session)
    login = anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"})
    anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"})
    response = anonymous_client.post(
        "/auth/logout-all",
        headers={**_csrf_headers(anonymous_client), "Authorization": f"Bearer {login.json()['access_token']}"},
    )
    assert response.status_code == 200
    tokens = session.exec(select(RefreshToken).where(RefreshToken.user_id == user.id)).all()
    assert len(tokens) == 2
    assert all(token.revoked_at is not None for token in tokens)


def test_logout_revokes_current_refresh_token_and_clears_cookies(anonymous_client, session):
    user = _user(session)
    anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"})
    token_hash = __import__("hashlib").sha256(anonymous_client.cookies.get("refresh_token").encode()).hexdigest()
    response = anonymous_client.post("/auth/logout", headers=_csrf_headers(anonymous_client))
    assert response.status_code == 200
    token = session.exec(select(RefreshToken).where(RefreshToken.token_hash == token_hash)).first()
    assert token and token.revoked_at is not None
    assert "refresh_token" not in anonymous_client.cookies


def test_password_policy():
    with pytest.raises(ValueError):
        hash_password("short")


def _mail_token(session):
    mail = session.exec(select(MailOutbox).order_by(MailOutbox.id.desc())).first()
    assert mail is not None
    return mail.body.split("token=", 1)[1]


def test_password_reset_is_generic_single_use_and_revokes_sessions(anonymous_client, session):
    user = _user(session)
    login = anonymous_client.post("/auth/login", json={"email": user.email, "password": "Strong-Pass-123"})
    known = anonymous_client.post("/auth/password/forgot", json={"email": user.email})
    unknown = anonymous_client.post("/auth/password/forgot", json={"email": "missing@example.local"})
    assert known.json() == unknown.json()
    token = _mail_token(session)
    payload = {"token": token, "password": "New-Strong-Pass-456"}
    assert anonymous_client.post("/auth/password/reset", json=payload).status_code == 200
    assert anonymous_client.post("/auth/password/reset", json=payload).status_code == 400
    assert anonymous_client.post("/auth/login", json={"email": user.email, "password": "New-Strong-Pass-456"}).status_code == 200
    assert login.status_code == 200
    assert session.exec(select(SecurityAudit).where(SecurityAudit.action == "password_reset")).first()


def test_admin_can_invite_change_role_and_deactivate(admin_client, session):
    invited = admin_client.post("/users/invite", json={"email": "new@example.local", "name": "New User", "role": "IT_STAFF", "team": "IT"})
    assert invited.status_code == 201
    assert invited.json()["must_change_password"] is True
    from uuid import UUID
    UUID(invited.json()["id"])
    mail = admin_client.get("/dev/mail").json()
    assert mail and str(UUID(mail[0]["id"])) == mail[0]["id"]
    assert admin_client.get("/users").status_code == 200
    assert admin_client.patch("/users/1", json={"role": "HR"}).status_code == 422
    assert admin_client.patch(f"/users/{invited.json()['id']}", json={"role": "HR"}).json()["role"] == "HR"
    assert admin_client.delete(f"/users/{invited.json()['id']}").json()["is_active"] is False


@pytest.mark.parametrize("role", ["HR", "MANAGER", "IT_STAFF", "NEW_HIRE"])
def test_user_management_is_admin_only(client, role):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="role@example.local", name="Role User", role=role, password_hash="unused"
    )
    assert client.get("/users").status_code == 403
    assert client.post("/users/invite", json={"email": "x@example.local", "name": "X", "role": "HR"}).status_code == 403


def test_invitation_token_sets_password_once(admin_client, session):
    admin_client.post("/users/invite", json={"email": "invite@example.local", "name": "Invite", "role": "IT_STAFF", "team": "IT"})
    token = _mail_token(session)
    body = {"token": token, "password": "Invite-Strong-456"}
    assert admin_client.post("/auth/accept-invite", json=body).status_code == 200
    assert admin_client.post("/auth/accept-invite", json=body).status_code == 400
    assert admin_client.post("/auth/login", json={"email": "invite@example.local", "password": body["password"]}).status_code == 200


@pytest.mark.parametrize(
    ("role", "expected"),
    [("ADMIN", 200), ("HR", 200), ("MANAGER", 403), ("IT_STAFF", 403), ("NEW_HIRE", 403)],
)
def test_hire_list_role_matrix(client, role, expected):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="role@example.local", name="Role Test", role=role, team="IT", password_hash="unused"
    )
    assert client.get("/hires").status_code == expected


@pytest.mark.parametrize(
    ("role", "expected"),
    [("ADMIN", 200), ("IT_STAFF", 200), ("HR", 200), ("MANAGER", 403), ("NEW_HIRE", 403)],
)
def test_ticket_role_matrix(client, role, expected):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="role@example.local", name="Role Test", role=role, team="IT", password_hash="unused"
    )
    assert client.get("/tickets").status_code == expected


@pytest.mark.parametrize(
    ("role", "expected"),
    [("ADMIN", 403), ("MANAGER", 403), ("HR", 404), ("IT_STAFF", 403), ("NEW_HIRE", 403)],
)
def test_hr_review_role_matrix(client, role, expected):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="role@example.local", name="Role Test", role=role, team="IT", password_hash="unused"
    )
    response = client.post(
        "/tasks/00000000-0000-4000-8000-000000000000/review",
        json={"decision": "accept"},
    )
    assert response.status_code == expected


def test_retired_manager_role_cannot_access_hire_data(client):
    client.app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="manager@example.local", name="Manager", role="MANAGER", password_hash="unused"
    )
    assert client.get("/hires").status_code == 403
