"""Bring legacy pending alternatives into the unified HR queue."""
from datetime import datetime
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision = "0020_backfill_legacy_alternatives"
down_revision = "0019_department_alternative_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        """
        SELECT tickets.id AS ticket_id, tickets.task_id, tickets.hire_id,
               tickets.team, tickets.title AS suggested_title,
               tickets.estimate_days AS suggested_days, tickets.updated_at,
               tasks.title AS original_title
        FROM tickets
        JOIN tasks ON tasks.id = tickets.task_id
        WHERE tickets.status = 'alternative_pending'
          AND tickets.hire_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM alternative_requests
              WHERE alternative_requests.ticket_id = tickets.id
                AND alternative_requests.status = 'pending'
          )
        """
    )).mappings().all()
    now = datetime.utcnow()
    for row in rows:
        bind.execute(sa.text(
            """
            INSERT INTO alternative_requests (
                public_id, ticket_id, task_id, hire_id, department,
                original_title, issue, suggested_title, suggested_days,
                requested_by_id, source, status, decision_by_id, decision_note,
                created_at, updated_at
            ) VALUES (
                :public_id, :ticket_id, :task_id, :hire_id, :department,
                :original_title, :issue, :suggested_title, :suggested_days,
                NULL, 'progress_monitor', 'pending', NULL, NULL,
                :created_at, :updated_at
            )
            """),
            {
                "public_id": str(uuid4()),
                "ticket_id": row["ticket_id"],
                "task_id": row["task_id"],
                "hire_id": row["hire_id"],
                "department": row["team"],
                "original_title": row["original_title"],
                "issue": "Legacy alternative recommendation awaiting HR review.",
                "suggested_title": row["suggested_title"],
                "suggested_days": row["suggested_days"] or 1,
                "created_at": row["updated_at"] or now,
                "updated_at": row["updated_at"] or now,
            },
        )


def downgrade() -> None:
    # The migrated rows can be genuine operational requests; preserve them.
    pass
