# Floodline: the API and the web app in one container.
# The demo replays recorded model answers (no API key); set MODEL_API_KEY and
# FLOODLINE_MODEL_MODE=live to analyse new photos.

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY floodline/ floodline/
COPY data/ data/
RUN uv sync --frozen --no-dev
COPY --from=web /web/dist web/dist

ENV FLOODLINE_MODEL_MODE=replay \
    FLOODLINE_STATE_DIR=/app/var \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8080
# The demo scenarios, seeded beforehand from the recorded answers with
#   floodline seed --city hue && floodline seed --city valencia
# (seeding the clips takes minutes on a one-CPU build machine, so it isn't done here).
COPY var/reports var/reports

EXPOSE 8080
CMD ["sh", "-c", "uvicorn floodline.api:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
