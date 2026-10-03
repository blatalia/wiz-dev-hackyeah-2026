# Agent frontend

## Chatbot setup

Use Python 3.11 or newer. From the repository root, create or activate the shared virtual environment,
then enter `agent_frontend`:

```bash
python3 -m venv .venv
source .venv/bin/activate
cd agent_frontend
python -m pip install -r requirements.txt
cp .env.example .env
```

Get a key from [Google AI Studio](https://aistudio.google.com/apikey) for a project
on the free tier, then edit `.env`:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
```

Start the app:

```bash
python -m streamlit run main.py
```

The app loads `.env` from `agent_frontend` regardless of the working directory.
Exported environment variables take precedence over `.env`. Restart the app after
changing the key or model. `.env` files are ignored by Git; commit only the blank
`.env.example` template.

The default model has a [free tier](https://ai.google.dev/gemini-api/docs/pricing).
Free-tier quotas apply; the app displays an error when the API reports a quota limit.
Billing is controlled by your Google project, not by the app.

## Container deployment

Run from the repository root with Docker installed and
`agent_frontend/.env` configured:

```bash
docker build -t baltic-agent ./agent_frontend
docker network create baltic-demo
docker run -d --name agent --network baltic-demo \
  --env-file agent_frontend/.env -p 8501:8501 baltic-agent
```

If `baltic-demo` already exists, skip the network creation command.
Open `http://localhost:8501` on the host. Other containers attached to `baltic-demo`
can reach Streamlit at `http://agent:8501`. Remote machines can use
`http://<docker-host-address>:8501` when the host network permits inbound traffic.
Streamlit listens on `0.0.0.0:8501` inside the container; `-p 8501:8501` publishes
that port on the host. Container-to-container access on the shared network also
works without `-p`.

The image runs as a non-root user and checks Streamlit's `/_stcore/health`
endpoint. API configuration is supplied at runtime through `--env-file`; `.env`
and `.venv` are excluded from the build context. Recreate the container after
changing environment variables.

## Layout and checks

Run the following checks from `agent_frontend` with the shared `.venv` active.

`main.py` contains the Streamlit interface and Gemini calls.
`tests/test_chatbot.py` contains offline tests discovered by Python's unittest runner.
This app runs directly with Streamlit and does not require a separate build step.

```bash
python -m pip install -r requirements-dev.txt
python -m ruff check .
python -m ruff format --check .
python -m unittest discover -s tests -v
```

Dependencies are bounded in the requirements files. A resolved dependency lockfile
could not be generated in the development sandbox because package downloads were
unavailable.
