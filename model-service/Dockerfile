# Run `uv run train.py` before building — this image serves a pre-trained
# artifact, it doesn't train one.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY features.py app.py ./
COPY artifacts ./artifacts

EXPOSE 8000
CMD [".venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
