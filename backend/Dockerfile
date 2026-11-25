FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/data
ENV DATABASE_URL=sqlite:////app/data/onboarding.db
ENV LANGGRAPH_CHECKPOINT_DB=/app/data/onboarding.checkpoints.sqlite
ENV ONBOARDIQ_MCP_DB_DIR=/app/data
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
