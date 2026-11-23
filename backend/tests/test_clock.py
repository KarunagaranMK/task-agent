from datetime import date, datetime, timezone

import pytest

from app.services.clock import BusinessCalendar, Clock


def test_business_calendar_skips_weekends_and_holidays():
    calendar = BusinessCalendar(holidays=frozenset({date(2026, 11, 26)}))
    assert calendar.add_business_days(date(2026, 11, 23), 3) == date(2026, 11, 27)
    assert calendar.business_days_between(date(2026, 11, 23), date(2026, 11, 27)) == 3


def test_business_day_count_is_signed_and_excludes_start_date():
    calendar = BusinessCalendar()
    assert calendar.business_days_between(date(2026, 11, 20), date(2026, 11, 23)) == 1
    assert calendar.business_days_between(date(2026, 11, 23), date(2026, 11, 20)) == -1


def test_day_one_deadline_is_previous_business_day():
    calendar = BusinessCalendar()
    assert calendar.deadline_before(date(2026, 11, 23)) == date(2026, 11, 20)


def test_clock_keeps_utc_and_validates_timezone():
    clock = Clock(timezone_name="Asia/Kolkata")
    aware = datetime(2026, 11, 23, 10, tzinfo=timezone.utc)
    assert clock.to_utc(aware) == aware
    with pytest.raises(ValueError, match="timezone-aware"):
        clock.to_utc(datetime(2026, 11, 23, 10))
    with pytest.raises(ValueError, match="Unknown timezone"):
        Clock(timezone_name="Not/A_Timezone")


def test_demo_clock_offset_moves_only_by_business_days():
    base = Clock()
    demo = Clock(demo_offset_business_days=2)
    assert demo.today() == base.calendar.add_business_days(base.local_today(), 2)
