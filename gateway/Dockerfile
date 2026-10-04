# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GATEWAY_LOG_DIR=/home/gateway/logs

WORKDIR /app

# Both requirements files are needed before installing the gateway dependencies.
COPY gateway/requirements.txt ./gateway/
COPY mcp/requirements.txt ./mcp/
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r gateway/requirements.txt \
    && useradd --create-home --uid 10001 gateway

COPY gateway/ ./gateway/
COPY llm/ ./llm/
COPY mcp/tools_bianka.py ./mcp/
COPY case_files/ ./case_files/
COPY anonymization_utils/ ./anonymization_utils/
COPY sql_detector/ ./sql_detector/
COPY config/ ./config/

USER gateway

EXPOSE 8000/tcp

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["python", "-m", "uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
