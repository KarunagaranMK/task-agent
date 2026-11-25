"""Add stable public UUIDs to hires while preserving internal integer keys."""
from uuid import uuid4

from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = "0010_hire_public_uuid"
down_revision = "0009_hire_start_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("hires")}
    if "public_id" not in columns:
        with op.batch_alter_table("hires") as batch:
            batch.add_column(Column("public_id", String(length=36), nullable=True))

    rows = bind.execute(text("SELECT id FROM hires WHERE public_id IS NULL")).scalars().all()
    for hire_id in rows:
        bind.execute(
            text("UPDATE hires SET public_id = :public_id WHERE id = :hire_id"),
            {"public_id": str(uuid4()), "hire_id": hire_id},
        )

    with op.batch_alter_table("hires") as batch:
        batch.alter_column("public_id", existing_type=String(length=36), nullable=False)

    indexes = {index["name"] for index in inspect(bind).get_indexes("hires")}
    if "ix_hires_public_id" not in indexes:
        op.create_index("ix_hires_public_id", "hires", ["public_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("hires")}
    indexes = {index["name"] for index in inspect(bind).get_indexes("hires")}
    if "ix_hires_public_id" in indexes:
        op.drop_index("ix_hires_public_id", table_name="hires")
    if "public_id" in columns:
        with op.batch_alter_table("hires") as batch:
            batch.drop_column("public_id")
