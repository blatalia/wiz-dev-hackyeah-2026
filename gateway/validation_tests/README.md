# Guardrail validation

This suite calls the guardrails' Python functions directly. It does not import
`gateway.main`, start FastAPI, send `/chat` requests, or start the DynamoDB poller.
LLM and PII cases use the real MGA and Hugging Face services with runtime credentials.
All examples are synthetic. Validation suppresses production event/log writes.

Each guardrail has a positive and negative example. Disabled cases append
**Guardrail is off** to the report's Input field. This annotation is for display
and is not sent to the guardrail or the LLM.

| Guardrail | Positive | Negative |
| --- | --- | --- |
| `initial_input_check` | Allowed aggregate analysis | Instruction override and restricted disclosure |
| SQL detector used by input check | Ordinary request | SQL injection |
| `llm_output_check` | Caveated financial analysis | Claim contradicting the case-file caveats |
| `tool_access_check` | Tool request: `REJECT` | Same request: `ALLOW` |
| PII anonymization | Synthetic email becomes `[EMAIL]` | Same text: original email stays visible |
| Response token cap | Provider receives `max_tokens=32` | Provider receives fallback `10000` |

The tool-call budget is enforced in the FastAPI endpoint, so it is outside this
suite's scope. Tool selection, retrieval and summaries are workflow steps rather
than individual guardrails. The response-token-cap cases call the real
`send_input_to_llm` with tools disabled and observe the actual provider request;
they validate the cap parameter, rather than measuring generated tokens.

## Run locally

Run the shell script from the repository root:

```bash
./gateway/validation_tests/run.sh
```

It activates the current virtual environment, a repository `.venv`, or the
existing `../.venv` (creating a repository `.venv` if none exists), installs the
gateway requirements, exports variables from `gateway/.env`, then runs the suite.
To use another environment file or pass suite arguments:

```bash
./gateway/validation_tests/run.sh .env
./gateway/validation_tests/run.sh gateway/.env --local-only
```

The script loads your chosen file at runtime without printing credential values.
Paths can be absolute or relative to the directory you invoke the script from.

From the repository root, with your Python environment active:

```bash
python -m pip install -r gateway/requirements.txt
python -m gateway.validation_tests
```

Export `MGA_TOKEN`, `HF_TOKEN` and `API_KEY` in the process environment before
running. The suite does not load or print `.env` files or credential values.
MGA uses `MGA_TOKEN`; the existing PII detector uses `HF_TOKEN` and `API_KEY`.
There is no need to supply AWS credentials. Each case restores the original
environment afterwards.

To use the existing gateway container configuration and its runtime credentials:

```bash
docker compose --env-file /dev/null -f compose.local.yaml build gateway
docker compose --env-file /dev/null -f compose.local.yaml run --rm --no-deps gateway python -m gateway.validation_tests
```

Compose supplies the container's configured credentials. This command overrides
the server command, and does not start the gateway server or its dependencies.

For only the deterministic SQL/tool-access cases:

```bash
python -m gateway.validation_tests --local-only
```

Gateway dependencies are still needed for importing the guardrails module.

The terminal report contains **Guardrail, Input, Output, Expected, Type, Result**.
Long cells wrap rather than truncate. `Type` identifies the positive or negative
case. A case passes only when its output matches `Expected`. Service failures or
missing credentials are `ERROR`, rather than passing negative cases accidentally.
LLM calls use a 30-second timeout with automatic retries disabled; malformed
evaluator verdicts are also reported as errors.
The process exits with `0` when all executed cases pass, or `1` if any case fails
or errors. Real classifier decisions can vary between runs.
