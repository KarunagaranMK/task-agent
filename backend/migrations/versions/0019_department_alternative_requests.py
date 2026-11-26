"""Persist department alternative proposals and HR decisions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0019_department_alternative_requests"
down_revision = "0018_employee_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "alternative_requests" not in inspect(bind).get_table_names():
        op.create_table(
            "alternative_requests",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("public_id", sa.String(length=36), nullable=False),
            sa.Column("ticket_id", sa.Integer(), nullable=False),
            sa.Column("task_id", sa.Integer(), nullable=False),
            sa.Column("hire_id", sa.Integer(), nullable=False),
            sa.Column("department", sa.String(), nullable=False),
            sa.Column("original_title", sa.String(), nullable=False),
            sa.Column("issue", sa.String(), nullable=False),
            sa.Column("suggested_title", sa.String(), nullable=False),
            sa.Column("suggested_days", sa.Integer(), nullable=False),
            sa.Column("requested_by_id", sa.Integer(), nullable=True),
            sa.Column("source", sa.String(), nullable=False, server_default="department"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("decision_by_id", sa.Integer(), nullable=True),
            sa.Column("decision_note", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
            sa.ForeignKeyConstraint(["hire_id"], ["hires.id"]),
            sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["decision_by_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("public_id"),
        )
    indexes = {index["name"] for index in inspect(bind).get_indexes("alternative_requests")}
    for name, columns in (
        ("ix_alternative_requests_public_id", ["public_id"]),
        ("ix_alternative_requests_ticket_id", ["ticket_id"]),
        ("ix_alternative_requests_task_id", ["task_id"]),
        ("ix_alternative_requests_hire_id", ["hire_id"]),
        ("ix_alternative_requests_department", ["department"]),
        ("ix_alternative_requests_status", ["status"]),
    ):
        if name not in indexes:
            op.create_index(name, "alternative_requests", columns, unique=name.endswith("public_id"))



def downgrade() -> None:
    if "alternative_requests" in inspect(op.get_bind()).get_table_names():
        op.drop_table("alternative_requests")
