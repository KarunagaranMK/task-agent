"""Add human comments to work tickets."""
from alembic import op
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, inspect

revision = "0006_ticket_comments"
down_revision = "0005_sse_tickets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not inspect(op.get_bind()).has_table("ticket_comments"):
        op.create_table(
            "ticket_comments",
            Column("id", Integer, primary_key=True),
            Column("ticket_id", Integer, ForeignKey("tickets.id"), nullable=False, index=True),
            Column("author_id", Integer, ForeignKey("users.id"), nullable=False, index=True),
            Column("body", String(), nullable=False),
            Column("created_at", DateTime(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("ticket_comments")
