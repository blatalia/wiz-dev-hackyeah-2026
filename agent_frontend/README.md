# Agent frontend

Use Python 3.11 or newer. From the repository root, activate your virtual environment
and install dependencies:

```bash
python -m pip install -r agent_frontend/requirements.txt
```

Start the FastAPI gateway as described in [gateway/README.md](../gateway/README.md),
then start Streamlit from the repository root:

```bash
GATEWAY_URL=http://localhost:8000 python -m streamlit run agent_frontend/main.py
```

The frontend sends the current prompt to `POST /chat` and displays the plain-text
response. Chat messages stay in the UI; previous messages are not sent to the gateway.
A Thinking indicator is shown while waiting. The default gateway URL is
`http://localhost:8000`. Configuration comes from environment variables; the app
never loads `.env` files and needs no model API key.

## Container deployment

Build from the repository root:

```bash
docker build -t baltic-agent ./agent_frontend
docker network create baltic-demo
docker run -d --name agent --network baltic-demo \
  -e GATEWAY_URL=http://gateway:8000 -p 8501:8501 baltic-agent
```

Skip network creation if it already exists. The gateway must run on the same
network with the hostname `gateway`. Open `http://localhost:8501` on the host;
other containers on the network can reach `http://agent:8501`.
Streamlit binds to `0.0.0.0:8501`; the image runs as a non-root user and checks
`/_stcore/health`. Private files and virtual environments are excluded from builds.

## Checks

From `agent_frontend` with the virtual environment active:

```bash
python -m pip install -r requirements-dev.txt
python -m ruff check .
python -m ruff format --check .
python -m unittest discover -s tests -v
```
