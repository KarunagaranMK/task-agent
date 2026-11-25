"""Add stable public UUIDs to audit, template, experiment and mail resources."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0015_secondary_resource_public_uuid"
down_revision = "0014_ticket_comment_public_uuid"
branch_labels = None
depends_on = None


TABLES = ("audit_events", "security_audit", "onboarding_templates", "experiment_runs", "mail_outbox")


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
    for table in TABLES:
        _add_public_id(table)


def downgrade() -> None:
    bind = op.get_bind()
    for table in reversed(TABLES):
        columns = {column["name"] for column in inspect(bind).get_columns(table)}
        indexes = {index["name"] for index in inspect(bind).get_indexes(table)}
        index_name = f"ix_{table}_public_id"
        if index_name in indexes:
            op.drop_index(index_name, table_name=table)
        if "public_id" in columns:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("public_id")
