import pytest
from sqlmodel import SQLModel, Session, create_engine, select
from sqlmodel.pool import StaticPool

from app.db import database
from app.domain.models import User


def _engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    return engine


def test_request_session_rolls_back_flushed_route_writes_on_error(monkeypatch):
    engine = _engine()
    monkeypatch.setattr(database, "engine", engine)
    dependency = database.get_session()
    session = next(dependency)
    session.add(User(email="rollback@example.local", name="Rollback", role="HR", password_hash="unused"))

    # Route-level commits flush so subsequent route reads can see generated IDs,
    # but do not commit the request transaction.
    session.commit()
    assert session.in_transaction()

    with pytest.raises(RuntimeError, match="request failed"):
        dependency.throw(RuntimeError("request failed"))

    with Session(engine) as verify:
        assert verify.exec(select(User).where(User.email == "rollback@example.local")).first() is None


def test_request_session_commits_once_after_successful_response(monkeypatch):
    engine = _engine()
    monkeypatch.setattr(database, "engine", engine)
    dependency = database.get_session()
    session = next(dependency)
    session.add(User(email="success@example.local", name="Success", role="HR", password_hash="unused"))
    session.commit()

    with pytest.raises(StopIteration):
        next(dependency)

    with Session(engine) as verify:
        assert verify.exec(select(User).where(User.email == "success@example.local")).first() is not None


def test_commit_now_consumes_single_use_state_before_a_stream(monkeypatch):
    engine = _engine()
    monkeypatch.setattr(database, "engine", engine)
    dependency = database.get_session()
    session = next(dependency)
    session.add(User(email="stream@example.local", name="Stream", role="HR", password_hash="unused"))
    session.commit()

    database.commit_now(session)

    assert not session.in_transaction()
    with Session(engine) as verify:
        assert verify.exec(select(User).where(User.email == "stream@example.local")).first() is not None

    with pytest.raises(StopIteration):
        next(dependency)
