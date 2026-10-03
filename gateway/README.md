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
- `POST /chat` accepts `{"prompt": "Analyze customer revenue concentration."}`.

Chat checks the prompt, asks the LLM to select tools, calls those tools by name,
and returns plain text containing the LLM's text and the retrieved file contents.
It does not make a second LLM call to summarize tool results. Rejected input returns
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

## Tests

```bash
python -m pip install -r gateway/requirements-dev.txt
python -m unittest discover -s gateway/tests -v
```

The API tests use FastAPI's test client with mocked guardrails. Guardrail tests use
mocked provider SDKs and require no credentials. API tests skip if their HTTP test
dependencies are unavailable.
