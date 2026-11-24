"""Persist editable onboarding templates, app settings and experiment runs."""
from alembic import op
from sqlalchemy import Boolean, Column, DateTime, Integer, String, inspect

revision = "0007_admin_insights"
down_revision = "0006_ticket_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    if "onboarding_templates" not in existing:
        op.create_table(
            "onboarding_templates",
            Column("id", Integer, primary_key=True),
            Column("role_key", String(), nullable=False, index=True),
            Column("version", Integer(), nullable=False, server_default="1"),
            Column("tasks_json", String(), nullable=False, server_default="[]"),
            Column("active", Boolean(), nullable=False, server_default="true"),
            Column("created_at", DateTime(), nullable=False),
        )
    if "app_settings" not in existing:
        op.create_table(
            "app_settings",
            Column("key", String(), primary_key=True),
            Column("value", String(), nullable=False),
            Column("updated_at", DateTime(), nullable=False),
        )
    if "experiment_runs" not in existing:
        op.create_table(
            "experiment_runs",
            Column("id", Integer(), primary_key=True),
            Column("parameters_json", String(), nullable=False),
            Column("result_json", String(), nullable=False),
            Column("created_at", DateTime(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing = set(inspect(bind).get_table_names())
    for table in ("experiment_runs", "app_settings", "onboarding_templates"):
        if table in existing:
            op.drop_table(table)
