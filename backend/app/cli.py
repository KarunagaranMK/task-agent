"""Administrative bootstrap commands."""
from __future__ import annotations

import argparse
from getpass import getpass

from sqlmodel import Session, select

from app.auth import hash_password
from app.config import settings
from app.db.database import create_db, engine
from app.domain.models import User


def create_admin(email: str, name: str, password: str) -> None:
    if settings.DEMO_MODE:
        raise SystemExit("Set DEMO_MODE=false before creating the first administrator.")
    create_db()
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.email == email.lower())).first()
        if existing:
            raise SystemExit("A user with that email already exists.")
        user = User(email=email.lower(), name=name, role="ADMIN", password_hash=hash_password(password))
        session.add(user)
        session.commit()
    print(f"Created administrator account for {email.lower()}.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    admin_parser = commands.add_parser("create-admin", help="Create the first non-demo administrator")
    admin_parser.add_argument("--email", required=True)
    admin_parser.add_argument("--name", required=True)
    args = parser.parse_args()
    if args.command == "create-admin":
        password = getpass("New admin password (min 10 chars): ")
        confirmation = getpass("Confirm password: ")
        if password != confirmation:
            raise SystemExit("Passwords did not match.")
        create_admin(args.email, args.name, password)


if __name__ == "__main__":
    main()
