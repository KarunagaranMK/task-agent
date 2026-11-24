"""Track hire readiness and approval timing for operational insights."""
from alembic import op
from sqlalchemy import Column, DateTime, inspect

revision = "0008_insight_timestamps"
down_revision = "0007_admin_insights"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    hire_columns = {column["name"] for column in inspector.get_columns("hires")}
    task_columns = {column["name"] for column in inspector.get_columns("tasks")}
    if "ready_at" not in hire_columns:
        with op.batch_alter_table("hires") as batch:
            batch.add_column(Column("ready_at", DateTime(), nullable=True))
    additions = [
        ("approval_requested_at", Column("approval_requested_at", DateTime(), nullable=True)),
        ("approval_decided_at", Column("approval_decided_at", DateTime(), nullable=True)),
    ]
    for name, column in additions:
        if name not in task_columns:
            with op.batch_alter_table("tasks") as batch:
                batch.add_column(column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "ready_at" in {column["name"] for column in inspector.get_columns("hires")}:
        with op.batch_alter_table("hires") as batch:
            batch.drop_column("ready_at")
    task_columns = {column["name"] for column in inspector.get_columns("tasks")}
    for name in ("approval_decided_at", "approval_requested_at"):
        if name in task_columns:
            with op.batch_alter_table("tasks") as batch:
                batch.drop_column(name)
