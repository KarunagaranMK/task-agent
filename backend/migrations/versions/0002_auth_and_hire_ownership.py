"""Add local auth tables and hire ownership links.

Revision ID: 0002_auth_ownership
Revises: 0001_initial_schema
Create Date: 2026-11-23
"""
from alembic import op
from sqlalchemy import Column, Integer, inspect
from sqlmodel import SQLModel

from app.domain import models  # noqa: F401 — register current tables

revision = "0002_auth_ownership"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind=bind)
    existing = {column["name"] for column in inspect(bind).get_columns("hires")}
    if "manager_id" not in existing or "new_hire_user_id" not in existing:
        # SQLite can leave the Alembic shadow table behind if a previous batch
        # rebuild was interrupted after DDL (SQLite DDL is not transactional).
        op.execute("DROP TABLE IF EXISTS _alembic_tmp_hires")
        with op.batch_alter_table("hires") as batch:
            if "manager_id" not in existing:
                batch.add_column(Column("manager_id", Integer, nullable=True))
                batch.create_foreign_key("fk_hires_manager_user", "users", ["manager_id"], ["id"])
            if "new_hire_user_id" not in existing:
                batch.add_column(Column("new_hire_user_id", Integer, nullable=True))
                batch.create_foreign_key("fk_hires_new_hire_user", "users", ["new_hire_user_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("hires") as batch:
        batch.drop_constraint("fk_hires_new_hire_user", type_="foreignkey")
        batch.drop_constraint("fk_hires_manager_user", type_="foreignkey")
        batch.drop_column("new_hire_user_id")
        batch.drop_column("manager_id")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
