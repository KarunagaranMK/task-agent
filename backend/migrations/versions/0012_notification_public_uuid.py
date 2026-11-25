"""Add stable public UUIDs to notifications."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0012_notification_public_uuid"
down_revision = "0011_task_public_uuid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("notifications")}
    if "public_id" not in columns:
        with op.batch_alter_table("notifications") as batch:
            batch.add_column(Column("public_id", String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM notifications WHERE public_id IS NULL")).scalars().all()
    for notification_id in rows:
        bind.execute(
            text("UPDATE notifications SET public_id = :public_id WHERE id = :notification_id"),
            {"public_id": str(uuid4()), "notification_id": notification_id},
        )

    with op.batch_alter_table("notifications") as batch:
        batch.alter_column("public_id", existing_type=String(length=36), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes("notifications")}
    if "ix_notifications_public_id" not in indexes:
        op.create_index("ix_notifications_public_id", "notifications", ["public_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("notifications")}
    indexes = {index["name"] for index in inspect(bind).get_indexes("notifications")}
    if "ix_notifications_public_id" in indexes:
        op.drop_index("ix_notifications_public_id", table_name="notifications")
    if "public_id" in columns:
        with op.batch_alter_table("notifications") as batch:
            batch.drop_column("public_id")
