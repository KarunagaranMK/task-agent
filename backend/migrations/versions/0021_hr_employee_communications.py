"""Add HR-managed employee onboarding email metadata to the mail outbox."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0021_hr_employee_communications"
down_revision = "0020_backfill_legacy_alternatives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("mail_outbox")}
    with op.batch_alter_table("mail_outbox") as batch:
        if "hire_id" not in columns:
            batch.add_column(sa.Column("hire_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                "fk_mail_outbox_hire_id_hires", "hires", ["hire_id"], ["id"], ondelete="SET NULL"
            )
        if "kind" not in columns:
            batch.add_column(sa.Column("kind", sa.String(length=32), nullable=True))
        if "dedupe_key" not in columns:
            batch.add_column(sa.Column("dedupe_key", sa.String(length=200), nullable=True))
        if "created_by_id" not in columns:
            batch.add_column(sa.Column("created_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                "fk_mail_outbox_created_by_id_users", "users", ["created_by_id"], ["id"], ondelete="SET NULL"
            )

    indexes = {index["name"] for index in inspect(bind).get_indexes("mail_outbox")}
    if "ix_mail_outbox_hire_id" not in indexes:
        op.create_index("ix_mail_outbox_hire_id", "mail_outbox", ["hire_id"])
    if "ix_mail_outbox_kind" not in indexes:
        op.create_index("ix_mail_outbox_kind", "mail_outbox", ["kind"])
    if "ix_mail_outbox_dedupe_key" not in indexes:
        op.create_index("ix_mail_outbox_dedupe_key", "mail_outbox", ["dedupe_key"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    indexes = {index["name"] for index in inspect(bind).get_indexes("mail_outbox")}
    for name in ("ix_mail_outbox_dedupe_key", "ix_mail_outbox_kind", "ix_mail_outbox_hire_id"):
        if name in indexes:
            op.drop_index(name, table_name="mail_outbox")
    columns = {column["name"] for column in inspect(bind).get_columns("mail_outbox")}
    with op.batch_alter_table("mail_outbox") as batch:
        if "created_by_id" in columns:
            batch.drop_constraint("fk_mail_outbox_created_by_id_users", type_="foreignkey")
            batch.drop_column("created_by_id")
        if "dedupe_key" in columns:
            batch.drop_column("dedupe_key")
        if "kind" in columns:
            batch.drop_column("kind")
        if "hire_id" in columns:
            batch.drop_constraint("fk_mail_outbox_hire_id_hires", type_="foreignkey")
            batch.drop_column("hire_id")
