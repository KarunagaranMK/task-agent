"""Persist each hire's joining date."""
from datetime import date, datetime, timedelta

from alembic import op
from sqlalchemy import Column, Date, inspect, text

revision = "0009_hire_start_date"
down_revision = "0008_insight_timestamps"
branch_labels = None
depends_on = None


def _add_business_days(start: date, count: int) -> date:
    cursor = start
    remaining = max(0, count)
    while remaining:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5:
            remaining -= 1
    return cursor


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("hires")}
    if "start_date" not in columns:
        with op.batch_alter_table("hires") as batch:
            batch.add_column(Column("start_date", Date(), nullable=True))
            batch.create_index("ix_hires_start_date", ["start_date"], unique=False)

    rows = bind.execute(text("SELECT id, start_day, created_at FROM hires WHERE start_date IS NULL")).mappings()
    for row in rows:
        created = row["created_at"]
        if isinstance(created, str):
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        created_date = created.date() if isinstance(created, datetime) else date.today()
        joining = _add_business_days(created_date, int(row["start_day"]))
        bind.execute(text("UPDATE hires SET start_date = :start_date WHERE id = :id"),
                     {"start_date": joining.isoformat(), "id": row["id"]})


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("hires")}
    if "start_date" in columns:
        with op.batch_alter_table("hires") as batch:
            batch.drop_index("ix_hires_start_date")
            batch.drop_column("start_date")
