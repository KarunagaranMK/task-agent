"""Add short-lived single-use SSE access tickets."""
from alembic import op
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

revision = "0005_sse_tickets"
down_revision = "0004_scheduler_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stream_tickets",
        Column("id", Integer, primary_key=True),
        Column("user_id", Integer, ForeignKey("users.id"), nullable=False, index=True),
        Column("token_hash", String(), nullable=False, unique=True, index=True),
        Column("last_event_id", Integer(), nullable=False, server_default="0"),
        Column("expires_at", DateTime(), nullable=False),
        Column("used_at", DateTime(), nullable=True),
        Column("created_at", DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("stream_tickets")
