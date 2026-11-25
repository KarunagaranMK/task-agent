"""Store optional employee profile and onboarding preparation details."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0018_employee_profile"
down_revision = "0017_employee_archive"
branch_labels = None
depends_on = None

PROFILE_COLUMNS = {
    "work_email": sa.String(length=254),
    "work_location": sa.String(length=120),
    "employment_type": sa.String(length=80),
    "required_equipment": sa.String(length=1000),
    "required_software": sa.String(length=1000),
    "additional_notes": sa.String(length=2000),
}


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("hires")}
    missing = [(name, kind) for name, kind in PROFILE_COLUMNS.items() if name not in columns]
    if missing:
        with op.batch_alter_table("hires") as batch:
            for name, kind in missing:
                batch.add_column(sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("hires")}
    present = [name for name in PROFILE_COLUMNS if name in columns]
    if present:
        with op.batch_alter_table("hires") as batch:
            for name in present:
                batch.drop_column(name)
