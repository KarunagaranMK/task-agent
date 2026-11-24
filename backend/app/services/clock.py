"""Single source for UTC timestamps and organization business-day arithmetic."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class BusinessCalendar:
    """Business-day calendar with weekends and explicitly configured holidays."""

    holidays: frozenset[date] = field(default_factory=frozenset)

    def is_business_day(self, day: date) -> bool:
        return day.weekday() < 5 and day not in self.holidays

    def add_business_days(self, start: date, count: int) -> date:
        if count == 0:
            return start
        direction = 1 if count > 0 else -1
        remaining = abs(count)
        cursor = start
        while remaining:
            cursor += timedelta(days=direction)
            if self.is_business_day(cursor):
                remaining -= 1
        return cursor

    def business_days_between(self, start: date, end: date) -> int:
        """Count business days after start through end (negative in reverse)."""
        if start == end:
            return 0
        direction = 1 if end > start else -1
        cursor = start
        total = 0
        while cursor != end:
            cursor += timedelta(days=direction)
            if self.is_business_day(cursor):
                total += direction
        return total

    def deadline_before(self, joining_day: date) -> date:
        return self.add_business_days(joining_day, -1)


@dataclass(frozen=True)
class Clock:
    """Organization clock. Persist real event timestamps in UTC."""

    timezone_name: str = "Asia/Kolkata"
    calendar: BusinessCalendar = field(default_factory=BusinessCalendar)
    demo_offset_business_days: int = 0

    def __post_init__(self) -> None:
        try:
            ZoneInfo(self.timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{self.timezone_name}'") from exc

    def now_utc(self) -> datetime:
        return datetime.now(timezone.utc)

    def local_today(self) -> date:
        return self.now_utc().astimezone(ZoneInfo(self.timezone_name)).date()

    def today(self) -> date:
        return self.calendar.add_business_days(self.local_today(), self.demo_offset_business_days)

    def to_utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Timestamp must be timezone-aware")
        return value.astimezone(timezone.utc)


def load_clock(session, demo_offset_business_days: int = 0) -> Clock:
    """Load the organization timezone and holiday calendar from workspace settings."""
    from sqlmodel import select
    from app.domain.models import AppSetting

    rows = session.exec(select(AppSetting).where(AppSetting.key.in_(["timezone", "holidays"]))).all()
    values = {row.key: row.value for row in rows}
    try:
        holidays = frozenset(date.fromisoformat(item) for item in json.loads(values.get("holidays", "[]")))
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Workspace holidays must be ISO dates") from exc
    return Clock(
        timezone_name=values.get("timezone", "Asia/Kolkata"),
        calendar=BusinessCalendar(holidays=holidays),
        demo_offset_business_days=demo_offset_business_days,
    )
