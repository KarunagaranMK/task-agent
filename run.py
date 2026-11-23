"""Local-first launcher for the OnboardIQ demo."""
from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PIP = VENV / ("Scripts/pip.exe" if os.name == "nt" else "bin/pip")
NPM = shutil.which("npm") or ("npm.cmd" if os.name == "nt" else "npm")


def command(args: list[str], *, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, text=True, check=check)


def prepare(*, reset: bool = False) -> None:
    if sys.version_info < (3, 11):
        raise SystemExit("Python 3.11 or newer is required.")
    try:
        node = subprocess.check_output(["node", "--version"], text=True).strip().lstrip("v")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit("Node.js 20 or newer is required and must be on PATH.") from exc
    if int(node.split(".")[0]) < 20:
        raise SystemExit(f"Node.js 20 or newer is required (found {node}).")

    created_venv = not PYTHON.exists()
    if created_venv:
        command([sys.executable, "-m", "venv", str(VENV)], cwd=ROOT)
    requirements = ROOT / "backend" / "requirements.txt"
    marker = VENV / ".requirements.sha256"
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    if created_venv or not marker.exists() or marker.read_text(encoding="utf-8") != digest:
        command([str(PIP), "install", "-r", str(requirements)], cwd=ROOT)
        marker.write_text(digest, encoding="utf-8")
    if not (ROOT / "frontend" / "node_modules").is_dir():
        command([NPM, "install"], cwd=ROOT / "frontend")

    env_file = ROOT / ".env"
    if not env_file.exists():
        sample = (ROOT / ".env.example").read_text(encoding="utf-8")
        sample = sample.replace("JWT_SECRET=generated-by-run-py", f"JWT_SECRET={secrets.token_urlsafe(48)}")
        env_file.write_text(sample, encoding="utf-8")
    os.environ.setdefault("DEMO_MODE", "true")

    if reset:
        db = ROOT / "backend" / "onboarding.db"
        if db.exists():
            db.unlink()
    command([str(PYTHON), "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"], cwd=ROOT / "backend")
    # The prototype seeds demo records only when the persistent store is empty.
    if os.environ.get("DEMO_MODE", "true").lower() == "true":
        has_hires = subprocess.run(
            [str(PYTHON), "-c", "from app.db.database import engine; from sqlmodel import Session, select; from app.domain.models import Hire; s=Session(engine); print(bool(s.exec(select(Hire.id)).first())); s.close()"],
            cwd=ROOT / "backend", text=True, capture_output=True, check=True,
        ).stdout.strip() == "True"
        if reset or not has_hires:
            command([str(PYTHON), "seed.py"], cwd=ROOT / "backend")


def health(timeout: float = 45) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2) as response:
                if response.status == 200:
                    return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.5)
    return False


def ensure_port_free(port: int) -> None:
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(f"Port {port} is already in use. Stop the existing service and run again.") from exc


def start_service(label: str, args: list[str], *, cwd: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    proc = subprocess.Popen(
        args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )

    def forward() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(f"[{label}] {line}", end="", flush=True)

    threading.Thread(target=forward, name=f"{label}-logs", daemon=True).start()
    return proc


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace", line_buffering=True)
    parser = argparse.ArgumentParser(description="Run the OnboardIQ local demo")
    parser.add_argument("--reset", action="store_true", help="Recreate and reseed the demo database")
    parser.add_argument("--test", action="store_true", help="Run backend tests and frontend build")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    parser.add_argument("--prod", action="store_true", help="Build static frontend assets")
    opts = parser.parse_args()
    prepare(reset=opts.reset)
    if opts.test:
        command([str(PYTHON), "-m", "pytest", "backend/tests", "-q"], cwd=ROOT)
        command([NPM, "run", "build"], cwd=ROOT / "frontend")
        return 0
    if opts.prod:
        command([NPM, "run", "build"], cwd=ROOT / "frontend")

    ensure_port_free(8000)
    if not opts.prod:
        ensure_port_free(5173)

    backend_env = os.environ.copy()
    backend_env["SERVE_FRONTEND"] = "true" if opts.prod else "false"
    backend = start_service(
        "api",
        [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=ROOT / "backend", env=backend_env,
    )
    frontend = None if opts.prod else start_service(
        "web",
        [NPM, "run", "dev", "--", "--host", "127.0.0.1"], cwd=ROOT / "frontend", env=os.environ.copy(),
    )
    try:
        if not health() or backend.poll() is not None:
            raise RuntimeError("Backend did not become healthy at http://localhost:8000/health")
        print("\nOnboardIQ is running")
        print("  App:    http://localhost:5173" if not opts.prod else "  App:    http://localhost:8000")
        print("  API:    http://localhost:8000/docs")
        print("  Health: http://localhost:8000/health")
        print("  Demo:   Priya Sharma · Data Analyst · 8 days")
        if not opts.no_browser:
            import webbrowser
            webbrowser.open("http://localhost:8000" if opts.prod else "http://localhost:5173")
        while True:
            if backend.poll() is not None:
                raise RuntimeError("Backend exited unexpectedly.")
            if frontend is not None and frontend.poll() is not None:
                raise RuntimeError("Frontend exited unexpectedly.")
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in (frontend, backend):
            if proc and proc.poll() is None:
                proc.terminate()
        for proc in (frontend, backend):
            if proc:
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"OnboardIQ startup failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
