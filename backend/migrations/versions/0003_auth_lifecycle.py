"""Add one-time auth tokens, local mail outbox, and security audit."""
from alembic import op
from sqlmodel import SQLModel

from app.domain import models  # noqa: F401 — register current tables

revision = "0003_auth_lifecycle"
down_revision = "0002_auth_ownership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    SQLModel.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    op.drop_table("security_audit")
    op.drop_table("mail_outbox")
    op.drop_table("one_time_tokens")
