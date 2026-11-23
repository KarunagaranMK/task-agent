"""Single-process monitor scheduler; the durable lease protects extra workers."""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session

from app.config import settings
from app.db.database import engine
from app.services.orchestrator import monitor_tick

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _run_monitor() -> None:
    try:
        with Session(engine) as session:
            monitor_tick(session)
    except Exception:
        logger.exception("Scheduled monitor cycle failed")


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        _run_monitor,
        "interval",
        minutes=max(1, settings.MONITOR_INTERVAL_MINUTES),
        id="onboardiq-monitor",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    _scheduler = scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
