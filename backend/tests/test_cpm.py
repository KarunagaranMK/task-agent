import pytest
from app.services.cpm import CPMTask, compute_cpm, get_remaining_days, is_stalled


def _t(key: str, rem: float, deps: list[str] | None = None) -> CPMTask:
    return CPMTask(key=key, remaining_days=rem, deps=deps or [])


# ---------------------------------------------------------------------------
# Basic forward / backward pass
# ---------------------------------------------------------------------------

def test_linear_chain_es_ef():
    tasks = [_t("A", 2), _t("B", 3, ["A"]), _t("C", 1, ["B"])]
    result = compute_cpm(tasks, deadline=10)
    tm = {t.key: t for t in result}
    assert tm["A"].es == 0
    assert tm["A"].ef == 2
    assert tm["B"].es == 2
    assert tm["B"].ef == 5
    assert tm["C"].es == 5
    assert tm["C"].ef == 6


def test_critical_path_marked():
    # A(3) -> C(2) -> D(2)  total=7, B(1) -> D  total=3
    tasks = [_t("A", 3), _t("B", 1), _t("C", 2, ["A"]), _t("D", 2, ["B", "C"])]
    result = compute_cpm(tasks, deadline=10)
    tm = {t.key: t for t in result}
    assert tm["A"].critical
    assert tm["C"].critical
    assert tm["D"].critical
    # B is NOT on the critical path
    assert not tm["B"].critical


def test_negative_slack_means_at_risk():
    tasks = [_t("A", 5), _t("B", 5, ["A"])]
    result = compute_cpm(tasks, deadline=8)
    min_slack = min(t.slack for t in result)
    assert min_slack < 0


def test_zero_slack_critical():
    tasks = [_t("A", 3), _t("B", 3, ["A"])]
    result = compute_cpm(tasks, deadline=6)
    for t in result:
        assert t.slack == pytest.approx(0.0)
        assert t.critical


def test_cycle_detection():
    tasks = [_t("A", 1, ["B"]), _t("B", 1, ["A"])]
    with pytest.raises(ValueError, match="Cycle"):
        compute_cpm(tasks, deadline=5)


def test_empty_tasks():
    result = compute_cpm([], deadline=5)
    assert result == []


def test_parallel_tasks_max_ef():
    # C starts after max(A.ef=2, B.ef=3)=3
    tasks = [_t("A", 2), _t("B", 3), _t("C", 1, ["A", "B"])]
    result = compute_cpm(tasks, deadline=10)
    tm = {t.key: t for t in result}
    assert tm["C"].es == pytest.approx(3.0)
    assert tm["C"].ef == pytest.approx(4.0)


def test_single_task():
    tasks = [_t("X", 4)]
    result = compute_cpm(tasks, deadline=10)
    assert len(result) == 1
    assert result[0].es == 0
    assert result[0].ef == 4
    assert result[0].slack == pytest.approx(6.0)


# ---------------------------------------------------------------------------
# Stall detection
# ---------------------------------------------------------------------------

class _FakeTask:
    def __init__(self, status, dispatched_day, duration_days, last_activity_day):
        self.status = status
        self.dispatched_day = dispatched_day
        self.duration_days = duration_days
        self.last_activity_day = last_activity_day


def test_no_stall_active_task():
    t = _FakeTask("dispatched", 0, 5, 1)
    assert not is_stalled(t, current_day=2)


def test_stall_idle_2_days():
    t = _FakeTask("dispatched", 0, 5, 0)
    assert is_stalled(t, current_day=2)


def test_stall_overdue():
    t = _FakeTask("dispatched", 0, 2, 1)
    assert is_stalled(t, current_day=5)  # elapsed=5 > duration=2


def test_no_stall_non_dispatched():
    t = _FakeTask("pending", None, 3, None)
    assert not is_stalled(t, current_day=10)


# ---------------------------------------------------------------------------
# Remaining days
# ---------------------------------------------------------------------------

def test_remaining_done():
    assert get_remaining_days("done", 5, 0, 3) == 0.0


def test_remaining_pending():
    assert get_remaining_days("pending", 5, None, 3) == 5.0


def test_remaining_dispatched_partial():
    # dispatched_day=0, current_day=2, duration=5 → remaining=3
    assert get_remaining_days("dispatched", 5, 0, 2) == 3.0


def test_remaining_dispatched_overdue():
    # Overdue but at least 1 day
    assert get_remaining_days("dispatched", 2, 0, 5) == 1.0
