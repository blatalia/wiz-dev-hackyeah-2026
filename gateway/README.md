# Gateway

A small FastAPI server reusing `llm/inference.py` and the file-backed functions in
`mcp/tools_bianka.py`. No MCP server is needed.

Use Python 3.11 or newer. From the repository root with a virtual environment active:

```bash
python -m pip install -r gateway/requirements.txt
python -m uvicorn gateway.main:app --host 0.0.0.0 --port 8000
```

FastAPI loads `gateway/.env` into its process environment at startup. Keep
`MGA_TOKEN` there or supply it through an exported environment variable, which
takes precedence over the file. The path is independent of the working directory.
You can also start with
`python -m gateway.main`, which binds to `0.0.0.0:8000` for future container integration.

Alternatively, enter the token without displaying it or putting it in shell history (Bash):

```bash
read -rsp 'MGA token: ' MGA_TOKEN
export MGA_TOKEN
printf '\n'
python -m uvicorn gateway.main:app --host 0.0.0.0 --port 8000
```

A missing token returns HTTP 503 with a configuration message. Other failures log
the failed stage, exception type and available HTTP status in the server terminal,
without logging prompts, retrieved data, tokens or provider response bodies.

## Endpoints

- `GET /health` returns `{"status": "ok"}` without calling the LLM.
- `POST /chat` accepts `{"prompt": "Analyze customer revenue concentration.", "history": []}`.

Chat checks the prompt, asks the LLM to select tools, and calls those tools by name.
When tools are used, it sends the original question and named tool results back to
the LLM and returns its summary. With no tools, it returns the initial LLM answer
directly. Successful responses are JSON objects with `text` and `history`.
Each history turn contains `prompt`, `answer` and `tool_results` (a list of
`{"name": "tool_name", "content": "full result"}` records). Send the returned
history with the next request to retain prior messages and tool calls/results.
Both LLM steps receive that history, and tool selection remains available on every
turn. The gateway stores no conversations itself. Rejected input returns
HTTP 403, whitespace-only input returns HTTP 400, and provider or tool failures return
HTTP 502 with a generic message. Invalid request bodies return HTTP 422.

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Analyze customer revenue concentration."}'
```

Point Streamlit's `GATEWAY_URL` at `http://localhost:8000` locally or
`http://gateway:8000` when both containers share a network and the gateway is named
`gateway`. Port 8000 must be published if accessed from outside the container network.

Permission checks, output checks and end-to-end processing remain stubs.
Tool execution currently has no permission enforcement.

## Docker

Build from the repository root (the gateway also imports `llm` and `mcp`):

```bash
docker build -f gateway/Dockerfile -t baltic-gateway .
docker run --rm --env-file gateway/.env -p 8000:8000 baltic-gateway
```

The image listens on `0.0.0.0:8000`, runs as a non-root user and checks `/health`.
`gateway/Dockerfile.dockerignore` limits the build context to gateway code, LLM code,
MCP tools and demo case files. Private environment files stay outside the image.
Requirements are installed before copying source code, so source edits reuse the
dependency layer. A BuildKit pip cache also reuses downloads when requirements change.

The local-only `compose.local.yaml` starts the gateway and Streamlit together.
It is ignored by Git and is not included in a clone. To test the local setup,
stop any manually running servers on ports 8000 and 8501 first, then run from the
repository root:

```bash
docker compose --env-file /dev/null -f compose.local.yaml up --build -d --wait
docker compose --env-file /dev/null -f compose.local.yaml ps
curl --fail http://localhost:8000/health
curl --fail http://localhost:8501/_stcore/health
curl --fail -X POST http://localhost:8000/chat \
  -H 'Content-Type: application/json' -d '{"prompt":"hi","history":[]}'
```

Open `http://localhost:8501` and try a prompt that retrieves data, then a follow-up.
Gateway credentials come from the existing `gateway/.env` at container creation;
Compose's `--env-file /dev/null` prevents unrelated root `.env` interpolation.
The health checks verify server readiness; the chat request checks the live LLM.

To rebuild after source edits, repeat the `up --build -d --wait` command.
To see logs or stop the local containers:

```bash
docker compose --env-file /dev/null -f compose.local.yaml logs -f gateway agent
docker compose --env-file /dev/null -f compose.local.yaml down
```

If the host ports are occupied, prefix the startup command with
`GATEWAY_PORT=8001 AGENT_PORT=8502` and use those ports for host checks.
Containers still communicate at `http://gateway:8000` on Compose's shared network.

## Tests

```bash
python -m pip install -r gateway/requirements-dev.txt
python -m unittest discover -s gateway/tests -v
```

The API tests use FastAPI's test client with mocked guardrails. Guardrail tests use
mocked provider SDKs and require no credentials. API tests skip if their HTTP test
dependencies are unavailable.
