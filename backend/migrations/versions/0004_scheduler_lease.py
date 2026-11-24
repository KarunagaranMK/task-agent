"""Add the durable monitor scheduler lease."""
from alembic import op
from sqlalchemy import Column, DateTime, Integer, String, inspect, text

revision = "0004_scheduler_lease"
down_revision = "0003_auth_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("scheduler_leases"):
        op.create_table(
            "scheduler_leases",
            Column("id", Integer, primary_key=True),
            Column("owner_id", String(), nullable=False, server_default=""),
            Column("lease_until", DateTime(), nullable=False),
            Column("updated_at", DateTime(), nullable=False),
        )
    if bind.execute(text("SELECT 1 FROM scheduler_leases WHERE id = 1")).first() is None:
        op.execute(
            "INSERT INTO scheduler_leases (id, owner_id, lease_until, updated_at) "
            "VALUES (1, '', '1970-01-01 00:00:00', '1970-01-01 00:00:00')"
        )


def downgrade() -> None:
    op.drop_table("scheduler_leases")
