from sqlmodel import create_engine, SQLModel, Session
from app.config import settings
from contextlib import contextmanager

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False}
)


def create_db():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session


@contextmanager
def get_session_ctx():
    with Session(engine) as session:
        yield session
