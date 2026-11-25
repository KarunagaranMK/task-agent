"""Add stable public UUIDs to user resources."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0013_user_public_uuid"
down_revision = "0012_notification_public_uuid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("users")}
    if "public_id" not in columns:
        with op.batch_alter_table("users") as batch:
            batch.add_column(Column("public_id", String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM users WHERE public_id IS NULL")).scalars().all()
    for user_id in rows:
        bind.execute(
            text("UPDATE users SET public_id = :public_id WHERE id = :user_id"),
            {"public_id": str(uuid4()), "user_id": user_id},
        )

    with op.batch_alter_table("users") as batch:
        batch.alter_column("public_id", existing_type=String(length=36), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes("users")}
    if "ix_users_public_id" not in indexes:
        op.create_index("ix_users_public_id", "users", ["public_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("users")}
    indexes = {index["name"] for index in inspect(bind).get_indexes("users")}
    if "ix_users_public_id" in indexes:
        op.drop_index("ix_users_public_id", table_name="users")
    if "public_id" in columns:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("public_id")
