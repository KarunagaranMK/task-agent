from app.services.experiment import run_experiment


def test_deterministic():
    r1 = run_experiment(200, 0.2, 42)
    r2 = run_experiment(200, 0.2, 42)
    assert r1 == r2


def test_orchestrator_beats_static():
    r = run_experiment(200, 0.2, 42)
    assert r["orchestrator_readiness_pct"] > r["static_checklist_readiness_pct"]


def test_improvement_positive():
    r = run_experiment(200, 0.2, 42)
    assert r["improvement_pct"] > 0


def test_different_seeds_different_results():
    r1 = run_experiment(100, 0.3, 42)
    r2 = run_experiment(100, 0.3, 99)
    # Results should differ with different seeds
    assert (
        r1["static_checklist_readiness_pct"] != r2["static_checklist_readiness_pct"]
        or r1["orchestrator_readiness_pct"] != r2["orchestrator_readiness_pct"]
    )


def test_high_stall_probability():
    r = run_experiment(200, 0.8, 42)
    # Orchestrator should still outperform
    assert r["orchestrator_readiness_pct"] >= r["static_checklist_readiness_pct"]


def test_zero_stall_probability():
    r = run_experiment(200, 0.0, 42)
    # Both should be equal (no stalls to rescue)
    assert r["static_checklist_readiness_pct"] == r["orchestrator_readiness_pct"]


def test_result_shape():
    r = run_experiment(50, 0.2, 1)
    assert "n_hires" in r
    assert "static_checklist_readiness_pct" in r
    assert "orchestrator_readiness_pct" in r
    assert "improvement_pct" in r
    assert "method" in r
    assert 0 <= r["static_checklist_readiness_pct"] <= 100
    assert 0 <= r["orchestrator_readiness_pct"] <= 100
