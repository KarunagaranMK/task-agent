import pytest
from fastapi.testclient import TestClient
from sqlmodel import create_engine, Session, SQLModel
from sqlmodel.pool import StaticPool
from app.main import app
from app.db.database import get_session
from app.auth import get_current_user
from app.domain.models import User
from app.config import settings

settings.MCP_MODE = "inprocess"


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def isolate_mcp_databases(tmp_path, monkeypatch):
    monkeypatch.setenv("ITSM_DB_PATH", str(tmp_path / "itsm.db"))
    monkeypatch.setenv("HRIS_DB_PATH", str(tmp_path / "hris.db"))
    monkeypatch.setenv("ONBOARDIQ_MCP_DB_DIR", str(tmp_path / "stdio-mcp"))


@pytest.fixture(name="client")
def client_fixture(session: Session):
    def _override():
        return session

    app.dependency_overrides[get_session] = _override
    app.dependency_overrides[get_current_user] = lambda: User(
        id=1, email="test@example.local", name="Test Admin", role="ADMIN", password_hash="unused"
    )
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture(name="anonymous_client")
def anonymous_client_fixture(session: Session):
    def _override():
        return session

    app.dependency_overrides[get_session] = _override
    app.dependency_overrides.pop(get_current_user, None)
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()
