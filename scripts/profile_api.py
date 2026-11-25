"""Small, repeatable local API load profile for the demo environment."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import platform
import statistics
import time

import httpx


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


async def profile(base_url: str, requests: int, concurrency: int, email: str, password: str) -> dict:
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout) as client:
        login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        if login.status_code != 200:
            raise RuntimeError(f"Profile login failed with HTTP {login.status_code}; check demo credentials and server URL.")
        token = login.json().get("access_token")
        if not token:
            raise RuntimeError("Profile login response did not include an access token.")

        endpoints = ("/api/v1/hires?page=1&page_size=20", "/api/v1/metrics")
        semaphore = asyncio.Semaphore(concurrency)
        results: list[tuple[str, float, int]] = []

        async def get_one(index: int) -> None:
            path = endpoints[index % len(endpoints)]
            async with semaphore:
                started = time.perf_counter()
                try:
                    response = await client.get(path, headers={"Authorization": f"Bearer {token}"})
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    results.append((path.split("?")[0], elapsed_ms, response.status_code))
                except httpx.HTTPError:
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    results.append((path.split("?")[0], elapsed_ms, 0))

        started = time.perf_counter()
        await asyncio.gather(*(get_one(index) for index in range(requests)))
        wall_seconds = time.perf_counter() - started

    profiles: dict[str, dict] = {}
    for endpoint in endpoints:
        path = endpoint.split("?")[0]
        samples = [(duration, status) for result_path, duration, status in results if result_path == path]
        latencies = [duration for duration, _status in samples]
        statuses: dict[str, int] = {}
        for _duration, status in samples:
            label = str(status) if status else "network_error"
            statuses[label] = statuses.get(label, 0) + 1
        profiles[path] = {
            "requests": len(samples),
            "status_counts": statuses,
            "latency_ms": {
                "p50": round(statistics.median(latencies), 2) if latencies else None,
                "p95": round(percentile(latencies, 0.95), 2) if latencies else None,
                "max": round(max(latencies), 2) if latencies else None,
            },
        }

    failures = sum(status != 200 for _path, _duration, status in results)
    return {
        "profile": "local read-only API load",
        "environment": {"platform": platform.platform(), "python": platform.python_version()},
        "base_url": base_url.rstrip("/"),
        "concurrency": concurrency,
        "total_requests": requests,
        "wall_seconds": round(wall_seconds, 3),
        "throughput_requests_per_second": round(requests / wall_seconds, 2) if wall_seconds else 0,
        "failures": failures,
        "endpoints": profiles,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.requests <= 5000:
        parser.error("--requests must be between 1 and 5000")
    if not 1 <= args.concurrency <= 100:
        parser.error("--concurrency must be between 1 and 100")
    email = os.environ.get("ONBOARDIQ_PROFILE_EMAIL", "hr@demo.local")
    password = os.environ.get("ONBOARDIQ_PROFILE_PASSWORD", "OnboardIQ-Demo!")
    report = asyncio.run(profile(args.base_url, args.requests, args.concurrency, email, password))
    print(json.dumps(report, indent=2))
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
