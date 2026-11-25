"""Add soft-archive state to onboarding employee records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0017_employee_archive"
down_revision = "0016_agent_executions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("hires")}
    if "archived" not in columns:
        with op.batch_alter_table("hires") as batch:
            batch.add_column(sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("hires")}
    if "archived" in columns:
        with op.batch_alter_table("hires") as batch:
            batch.drop_column("archived")
