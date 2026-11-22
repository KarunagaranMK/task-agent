.PHONY: install test run-backend run-frontend seed docker-up docker-down reset lint

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

test:
	cd backend && python -m pytest tests/ -v

run-backend:
	cd backend && uvicorn app.main:app --reload --port 8000

run-frontend:
	cd frontend && npm run dev

seed:
	cd backend && python seed.py

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

reset:
	curl -X POST http://localhost:8000/reset

lint:
	cd frontend && npm run build
