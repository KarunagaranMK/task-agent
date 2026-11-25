"""Persist LangGraph node execution summaries."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0016_agent_executions"
down_revision = "0015_secondary_resource_public_uuid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "agent_executions" not in inspect(bind).get_table_names():
        op.create_table(
            "agent_executions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("public_id", sa.String(length=36), nullable=False),
            sa.Column("thread_id", sa.String(), nullable=False),
            sa.Column("hire_id", sa.Integer(), nullable=True),
            sa.Column("agent_name", sa.String(), nullable=False),
            sa.Column("operation", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False),
            sa.Column("summary", sa.String(), nullable=False),
            sa.Column("error_code", sa.String(), nullable=True),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["hire_id"], ["hires.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("public_id"),
        )
    indexes = {index["name"] for index in inspect(bind).get_indexes("agent_executions")}
    definitions = (
        ("ix_agent_executions_public_id", ["public_id"], True),
        ("ix_agent_executions_thread_id", ["thread_id"], False),
        ("ix_agent_executions_hire_id", ["hire_id"], False),
        ("ix_agent_executions_agent_name", ["agent_name"], False),
        ("ix_agent_executions_operation", ["operation"], False),
    )
    for name, columns, unique in definitions:
        if name not in indexes:
            op.create_index(name, "agent_executions", columns, unique=unique)


def downgrade() -> None:
    op.drop_index("ix_agent_executions_operation", table_name="agent_executions")
    op.drop_index("ix_agent_executions_agent_name", table_name="agent_executions")
    op.drop_index("ix_agent_executions_hire_id", table_name="agent_executions")
    op.drop_index("ix_agent_executions_thread_id", table_name="agent_executions")
    op.drop_index("ix_agent_executions_public_id", table_name="agent_executions")
    op.drop_table("agent_executions")
