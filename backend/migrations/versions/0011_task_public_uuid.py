"""Add stable public UUIDs to task resources."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0011_task_public_uuid"
down_revision = "0010_hire_public_uuid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("tasks")}
    if "public_id" not in columns:
        with op.batch_alter_table("tasks") as batch:
            batch.add_column(Column("public_id", String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM tasks WHERE public_id IS NULL")).scalars().all()
    for task_id in rows:
        bind.execute(
            text("UPDATE tasks SET public_id = :public_id WHERE id = :task_id"),
            {"public_id": str(uuid4()), "task_id": task_id},
        )

    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("public_id", existing_type=String(length=36), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes("tasks")}
    if "ix_tasks_public_id" not in indexes:
        op.create_index("ix_tasks_public_id", "tasks", ["public_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("tasks")}
    indexes = {index["name"] for index in inspect(bind).get_indexes("tasks")}
    if "ix_tasks_public_id" in indexes:
        op.drop_index("ix_tasks_public_id", table_name="tasks")
    if "public_id" in columns:
        with op.batch_alter_table("tasks") as batch:
            batch.drop_column("public_id")
