"""Single-process monitor scheduler; the durable lease protects extra workers."""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session

from app.config import settings
from app.db.database import engine
from app.domain.models import AppSetting
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
    with Session(engine) as session:
        saved = session.get(AppSetting, "monitor_interval_minutes")
        interval = int(saved.value) if saved else settings.MONITOR_INTERVAL_MINUTES
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(
        _run_monitor,
        "interval",
        minutes=max(1, interval),
        id="onboardiq-monitor",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    _scheduler = scheduler


def update_monitor_interval(minutes: int) -> None:
    if _scheduler is not None and _scheduler.running:
        _scheduler.reschedule_job("onboardiq-monitor", trigger="interval", minutes=max(1, minutes))


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None


def scheduler_status() -> dict[str, object]:
    running = bool(_scheduler is not None and _scheduler.running)
    job = _scheduler.get_job("onboardiq-monitor") if running and _scheduler else None
    return {
        "enabled": settings.SCHEDULER_ENABLED,
        "running": running,
        "next_run_at": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "interval_minutes": max(1, int(job.trigger.interval.total_seconds() / 60)) if job else settings.MONITOR_INTERVAL_MINUTES,
    }
