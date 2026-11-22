"""
Critical Path Method (CPM) engine.
Forward/backward pass over open tasks to compute ES, EF, LS, LF, slack.
All logic is deterministic — no LLM involved.
"""
from typing import List, Dict
from collections import deque
from dataclasses import dataclass, field


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

    # Kahn's topological sort + cycle detection
    in_degree: Dict[str, int] = {t.key: 0 for t in tasks}
    children: Dict[str, List[str]] = {t.key: [] for t in tasks}

    for t in tasks:
        for dep in t.deps:
            if dep in task_map:
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

    # Effective project end
    project_ef = max(t.ef for t in tasks)
    effective_deadline = deadline if deadline > 0 else project_ef

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
