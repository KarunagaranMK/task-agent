from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from enum import Enum
from datetime import datetime
import json


class HireStatus(str, Enum):
    on_track = "on_track"
    at_risk = "at_risk"
    ready = "ready"


class TaskStatus(str, Enum):
    pending = "pending"
    awaiting_approval = "awaiting_approval"
    queued = "queued"
    dispatched = "dispatched"
    done = "done"
    blocked = "blocked"


class TaskTeam(str, Enum):
    IT = "IT"
    HR = "HR"
    Facilities = "Facilities"


class ApprovalState(str, Enum):
    none = "none"
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class TaskFlag(str, Enum):
    none = "none"
    watch = "watch"
    escalated = "escalated"
    rescheduled = "rescheduled"


class Hire(SQLModel, table=True):
    __tablename__ = "hires"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    role: str
    department: str
    start_day: int  # days from today when hired
    status: HireStatus = HireStatus.on_track
    readiness: float = 0.0
    projected_day: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tasks: List["Task"] = Relationship(back_populates="hire")


class Task(SQLModel, table=True):
    __tablename__ = "tasks"
    id: Optional[int] = Field(default=None, primary_key=True)
    hire_id: int = Field(foreign_key="hires.id")
    key: str  # unique per hire: "it:laptop"
    title: str
    team: TaskTeam
    duration_days: int
    depends_on: str = Field(default="[]")  # JSON list of task keys
    needs_approval: bool = False
    approval_state: ApprovalState = ApprovalState.none
    fallback_title: Optional[str] = None
    fallback_days: Optional[int] = None
    status: TaskStatus = TaskStatus.pending
    ticket_id: Optional[str] = None
    dispatched_day: Optional[int] = None
    last_activity_day: Optional[int] = None
    slack: Optional[float] = None
    critical: bool = False
    flag: TaskFlag = TaskFlag.none
    hire: Optional[Hire] = Relationship(back_populates="tasks")

    @property
    def depends_on_list(self) -> List[str]:
        return json.loads(self.depends_on)

    def set_depends_on(self, deps: List[str]):
        self.depends_on = json.dumps(deps)


class OutboxItem(SQLModel, table=True):
    __tablename__ = "outbox"
    id: Optional[int] = Field(default=None, primary_key=True)
    hire_id: int
    task_id: int
    idempotency_key: str = Field(unique=True)
    title: str
    team: str
    estimate_days: int
    created_at: datetime = Field(default_factory=datetime.utcnow)
    retry_count: int = 0


class AuditEvent(SQLModel, table=True):
    __tablename__ = "audit_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    day: int
    hire_id: int
    level: str  # info, warning, critical
    message: str
    actor_agent: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Notification(SQLModel, table=True):
    __tablename__ = "notifications"
    id: Optional[int] = Field(default=None, primary_key=True)
    for_role: str  # Manager, IT, HR, Facilities
    hire_id: Optional[int] = None
    task_id: Optional[int] = None
    message: str
    read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Ticket(SQLModel, table=True):
    __tablename__ = "tickets"
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: str = Field(unique=True)
    idempotency_key: str = Field(unique=True)
    title: str
    team: str
    estimate_days: int
    status: str = "open"  # open, in_progress, done, stalled
    hire_id: Optional[int] = None
    task_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SimState(SQLModel, table=True):
    __tablename__ = "sim_state"
    id: Optional[int] = Field(default=None, primary_key=True)
    current_day: int = 0
    itsm_offline: bool = False
