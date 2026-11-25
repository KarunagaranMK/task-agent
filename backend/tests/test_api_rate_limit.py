from app import main


def test_api_rate_limit_returns_problem_details_and_exempts_health(client, monkeypatch):
    monkeypatch.setattr(main, "_API_RATE_LIMIT", 1)
    main._API_RATE_BUCKETS.clear()

    first = client.post("/auth/password/forgot", json={"email": "missing@example.local"})
    limited = client.post("/auth/password/forgot", json={"email": "missing@example.local"})

    assert first.status_code == 200
    assert limited.status_code == 429
    assert limited.headers["content-type"].startswith("application/problem+json")
    assert limited.headers["retry-after"] == "60"
    assert limited.json()["code"] == "rate_limit_exceeded"
    assert limited.json()["request_id"] == limited.headers["x-request-id"]
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200
