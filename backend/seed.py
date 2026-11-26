#!/usr/bin/env python3
"""
Seed demo data: Priya scenario and two additional hires.
Run from backend/ directory: python seed.py
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session
from app.db.database import create_db, engine
from app.services.orchestrator import create_hire_with_plan, monitor_tick
from app.domain.models import User
from app.auth import hash_password, password_hasher
from app.config import settings
from sqlmodel import select


DEMO_PASSWORD = "OnboardIQ-Demo!"


def seed_demo_users(session: Session) -> dict[str, User]:
    users = [
        ("admin@demo.local", "Demo Admin", "ADMIN", None),
        ("hr@demo.local", "Demo HR", "HR", None),
        ("it@demo.local", "Jordan Kim", "IT_STAFF", "IT"),
        ("facilities@demo.local", "Taylor Reed", "IT_STAFF", "Facilities"),
    ]
    result: dict[str, User] = {}
    for email, name, role, team in users:
        user = session.exec(select(User).where(User.email == email)).first()
        if user is None:
            user = User(email=email, name=name, role=role, team=team, password_hash=hash_password(DEMO_PASSWORD))
        else:
            # Keep an existing demo database aligned when demo roles change.
            user.name = name
            user.role = role
            user.team = team
            user.is_active = True
            user.failed_logins = 0
            user.locked_until = None
            try:
                password_matches = password_hasher.verify(user.password_hash, DEMO_PASSWORD)
            except Exception:
                password_matches = False
            if not password_matches:
                user.password_hash = hash_password(DEMO_PASSWORD)
        session.add(user)
        session.commit()
        session.refresh(user)
        result[email] = user
    return result


def seed():
    create_db()
    with Session(engine) as session:
        demo_users = seed_demo_users(session) if settings.DEMO_MODE else {}
        # Demo hire 1: Priya — Data Analyst (the main demo scenario)
        priya = create_hire_with_plan(session, "Priya Sharma", "Data Analyst", "Analytics", 8)
        print(f"Created: {priya.name} (ID={priya.id}) — Data Analyst, start_day=8")

        # Demo hire 2: Alex — Software Engineer
        alex = create_hire_with_plan(session, "Alex Chen", "Software Engineer", "Engineering", 10)
        print(f"Created: {alex.name} (ID={alex.id}) — Software Engineer, start_day=10")

        # Demo hire 3: Maria — Default role
        maria = create_hire_with_plan(session, "Maria Garcia", "default", "Marketing", 6)
        print(f"Created: {maria.name} (ID={maria.id}) — default role, start_day=6")

        # Run one monitor tick to dispatch initial tasks
        monitor_tick(session)
        print("\nInitial monitor tick complete — root tasks dispatched.")
        print("\nDemo ready! Open http://localhost:5173")
        print("  - HR page shows all 3 hires with readiness bars")
        print("  - IT and Facilities each have a team-only task queue")
        print("  - HR review shows pending submissions and accepted handoff history")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--users-only", action="store_true")
    args = parser.parse_args()
    if args.users_only:
        create_db()
        if settings.DEMO_MODE:
            with Session(engine) as demo_session:
                seed_demo_users(demo_session)
    else:
        seed()
