from sqlmodel import create_engine, SQLModel, Session
from sqlalchemy import event
from app.config import settings
from contextlib import contextmanager

sqlite = settings.DATABASE_URL.startswith("sqlite")
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if sqlite else {},
)

if sqlite:
    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def create_db():
    SQLModel.metadata.create_all(engine)


class RequestSession(Session):
    """Keep API writes in one transaction until the request finishes successfully."""

    def commit(self) -> None:
        if self.info.get("defer_commit"):
            self.flush()
            return
        super().commit()


def get_session():
    session = RequestSession(engine, info={"defer_commit": True})
    try:
        yield session
        session.info["defer_commit"] = False
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def commit_now(session: Session) -> None:
    """Commit an operation before returning a long-lived streaming response."""
    session.info["defer_commit"] = False
    session.commit()


@contextmanager
def get_session_ctx():
    with Session(engine) as session:
        yield session
