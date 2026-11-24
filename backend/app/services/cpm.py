"""
Critical Path Method (CPM) engine.
Forward/backward pass over open tasks to compute ES, EF, LS, LF, slack.
All logic is deterministic — no LLM involved.
"""
from typing import List, Dict
from collections import deque
from dataclasses import dataclass, field
from typing import TypedDict


@dataclass
class CPMTask:
    key: str
    remaining_days: float
    deps: List[str] = field(default_factory=list)
    es: float = 0.0
    ef: float = 0.0
    ls: float = 0.0
    lf: float = 0.0
    slack: float = 0.0
    critical: bool = False


def compute_cpm(tasks: List[CPMTask], deadline: float) -> List[CPMTask]:
    """
    Compute CPM for a list of open tasks.
    deadline = number of days remaining until start_day.
    Returns tasks with ES/EF/LS/LF/slack/critical filled in.
    Raises ValueError on cycle detection.
    """
    if not tasks:
        return tasks

    task_map = {t.key: t for t in tasks}
    if len(task_map) != len(tasks):
        raise ValueError("Task keys must be unique")

    # Kahn's topological sort + cycle detection
    in_degree: Dict[str, int] = {t.key: 0 for t in tasks}
    children: Dict[str, List[str]] = {t.key: [] for t in tasks}

    for t in tasks:
        for dep in t.deps:
            if dep not in task_map:
                raise ValueError(f"Unknown dependency '{dep}' in task '{t.key}'")
            in_degree[t.key] += 1
            children[dep].append(t.key)

    queue: deque = deque([k for k, deg in in_degree.items() if deg == 0])
    topo_order: List[str] = []

    while queue:
        node = queue.popleft()
        topo_order.append(node)
        for child in children[node]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    if len(topo_order) != len(tasks):
        raise ValueError("Cycle detected in task dependencies")

    # Forward pass: ES/EF
    for key in topo_order:
        t = task_map[key]
        if not t.deps:
            t.es = 0.0
        else:
            t.es = max(
                (task_map[dep].ef for dep in t.deps if dep in task_map),
                default=0.0
            )
        t.ef = t.es + t.remaining_days

    # A zero or negative deadline is meaningful: it means the hire's Day-1
    # deadline has arrived or passed, and must produce negative slack.
    effective_deadline = deadline

    # Backward pass: LS/LF
    for key in reversed(topo_order):
        t = task_map[key]
        successors = [task_map[c] for c in children[key] if c in task_map]
        if not successors:
            t.lf = effective_deadline
        else:
            t.lf = min(s.ls for s in successors)
        t.ls = t.lf - t.remaining_days

    # Slack and critical path
    min_slack = min(t.lf - t.ef for t in tasks)
    for t in tasks:
        t.slack = t.lf - t.ef
        t.critical = abs(t.slack - min_slack) < 0.001

    return tasks


def get_remaining_days(
    status: str,
    duration_days: int,
    dispatched_day: int | None,
    current_day: int,
) -> float:
    """Calculate remaining days for a task based on its status."""
    if status == "done":
        return 0.0
    if status == "dispatched" and dispatched_day is not None:
        elapsed = current_day - dispatched_day
        remaining = duration_days - elapsed
        return max(1.0, float(remaining)) if remaining <= 0 else float(remaining)
    return float(duration_days)


def is_stalled(task, current_day: int, stall_days: int = 2) -> bool:
    """
    A task is stalled if:
    - no activity for >= stall_days, OR
    - elapsed time exceeds duration (overdue)
    Only applies to dispatched/queued tasks.
    """
    if task.status not in ("dispatched", "queued"):
        return False
    if task.dispatched_day is not None:
        elapsed = current_day - task.dispatched_day
        if elapsed > task.duration_days:
            return True
    if task.last_activity_day is not None:
        idle = current_day - task.last_activity_day
        return idle >= stall_days
    return False


class WhatIfResult(TypedDict):
    task_key: str
    delay_days: int
    projected_ready_day: float
    baseline_ready_day: float
    delta_days: float
    critical_path: list[str]
    tasks: list[CPMTask]


def compute_what_if(
    tasks: list[CPMTask],
    deadline: float,
    task_key: str,
    delay_days: int,
    current_day: float = 0,
) -> WhatIfResult:
    """Purely recompute project timing after adding delay to one open task."""
    if delay_days < 0 or delay_days > 10:
        raise ValueError("Delay must be between 0 and 10 business days")
    if not any(task.key == task_key for task in tasks):
        raise ValueError(f"Unknown or closed task '{task_key}'")
    baseline = compute_cpm(
        [CPMTask(key=t.key, remaining_days=t.remaining_days, deps=list(t.deps)) for t in tasks],
        deadline,
    )
    delayed_inputs = [
        CPMTask(key=t.key, remaining_days=t.remaining_days + (delay_days if t.key == task_key else 0), deps=list(t.deps))
        for t in tasks
    ]
    delayed = compute_cpm(delayed_inputs, deadline)
    baseline_finish = max((t.ef for t in baseline), default=0.0)
    delayed_finish = max((t.ef for t in delayed), default=0.0)
    critical_path = [t.key for t in delayed if t.critical]
    return {
        "task_key": task_key,
        "delay_days": delay_days,
        "projected_ready_day": current_day + delayed_finish,
        "baseline_ready_day": current_day + baseline_finish,
        "delta_days": delayed_finish - baseline_finish,
        "critical_path": critical_path,
        "tasks": delayed,
    }
