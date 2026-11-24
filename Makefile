.PHONY: install test coverage e2e qa-shots run-backend run-frontend seed docker-up docker-down reset lint dev verify

dev:
	python run.py

verify: test coverage lint e2e

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

test:
	python run.py --test

coverage:
	cd backend && python -m pytest tests -q --cov=app.services.cpm --cov=app.services.planner --cov=app.services.clock --cov=app.services.experiment --cov-report=term-missing --cov-fail-under=80

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
	python run.py --reset

lint:
	cd backend && python -m ruff check app tests --select E4,E7,E9,F
	cd frontend && npm run build

e2e:
	cd qa && npm test

qa-shots:
	cd qa && npm run qa:shots
