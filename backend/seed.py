#!/usr/bin/env python3
"""
Seed demo data: Priya scenario and two additional hires.
Run from backend/ directory: python seed.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import Session
from app.db.database import create_db, engine
from app.services.orchestrator import create_hire_with_plan, monitor_tick


def seed():
    create_db()
    with Session(engine) as session:
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
        print("  - Manager page shows pending approvals (Power BI, Repo Access)")
        print("  - IT page shows open tickets")
        print("  - Demo Panel: Advance Day, Run Monitor, ITSM Chaos")


if __name__ == "__main__":
    seed()
