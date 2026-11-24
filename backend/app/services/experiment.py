"""
Deterministic Monte Carlo experiment comparing:
  - Static Checklist: no stall intervention
  - Orchestrator: CPM-based stall detection + fallback reschedule
"""
import random
from typing import Dict, Any


def run_experiment(
    n_hires: int = 200,
    stall_probability: float = 0.2,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Simulate n_hires under two policies with a fixed seed.
    Returns Day-1 readiness % for each policy and improvement.
    """
    rng = random.Random(seed)
    static_ready = 0
    orchestrator_ready = 0

    for _ in range(n_hires):
        # Random hire parameters
        start_day = rng.randint(5, 15)

        # 5 tasks; critical path = longest 3 sequential tasks
        task_durations = [rng.randint(1, 4) for _ in range(5)]
        critical_path_days = sum(sorted(task_durations, reverse=True)[:3])

        # Random stall events
        stalls = [rng.random() < stall_probability for _ in task_durations]
        total_stall_days = sum(2 for s in stalls if s)

        # --- Static Checklist ---
        # No monitoring: full stall delay applies
        static_total = critical_path_days + total_stall_days
        static_ready += 1 if static_total <= start_day else 0

        # --- Orchestrator ---
        # Detects stalls on critical path (first 3 tasks), recovers ~60%
        # Also saves ~0.5 days via CPM rebalancing
        critical_stalls = stalls[:3]
        rescued_days = sum(int(2 * 0.6) for s in critical_stalls if s)
        orch_total = critical_path_days + total_stall_days - rescued_days - 0.5
        orch_total = max(orch_total, critical_path_days * 0.85)
        orchestrator_ready += 1 if orch_total <= start_day else 0

    static_pct = round(static_ready / n_hires * 100, 1)
    orch_pct = round(orchestrator_ready / n_hires * 100, 1)

    return {
        "n_hires": n_hires,
        "stall_probability": stall_probability,
        "seed": seed,
        "static_checklist_readiness_pct": static_pct,
        "orchestrator_readiness_pct": orch_pct,
        "improvement_pct": round(orch_pct - static_pct, 1),
        "method": (
            "Monte Carlo simulation with deterministic seed. "
            "Static: no stall intervention, full delay applies. "
            "Orchestrator: 60% stall recovery on critical-path tasks + "
            "0.5-day CPM rebalancing saving. "
            "Results are illustrative — verify with real deployment data."
        ),
    }
