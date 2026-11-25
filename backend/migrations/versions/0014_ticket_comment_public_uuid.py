"""Add stable public UUIDs to tickets and comments."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0014_ticket_comment_public_uuid"
down_revision = "0013_user_public_uuid"
branch_labels = None
depends_on = None


def _add_public_id(table: str) -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns(table)}
    if "public_id" not in columns:
        with op.batch_alter_table(table) as batch:
            batch.add_column(Column("public_id", String(length=36), nullable=True))

    rows = bind.execute(text(f"SELECT id FROM {table} WHERE public_id IS NULL")).scalars().all()
    for row_id in rows:
        bind.execute(
            text(f"UPDATE {table} SET public_id = :public_id WHERE id = :row_id"),
            {"public_id": str(uuid4()), "row_id": row_id},
        )

    with op.batch_alter_table(table) as batch:
        batch.alter_column("public_id", existing_type=String(length=36), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes(table)}
    index_name = f"ix_{table}_public_id"
    if index_name not in indexes:
        op.create_index(index_name, table, ["public_id"], unique=True)


def upgrade() -> None:
    _add_public_id("tickets")
    _add_public_id("ticket_comments")


def downgrade() -> None:
    bind = op.get_bind()
    for table in ("ticket_comments", "tickets"):
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        index_name = f"ix_{table}_public_id"
        indexes = {index["name"] for index in inspect(bind).get_indexes(table)}
        if index_name in indexes:
            op.drop_index(index_name, table_name=table)
        if "public_id" in columns:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("public_id")
