# Gateway

The implemented functions in `guardrails/guardrails.py` reuse `llm/inference.py`
and the file-backed functions in `mcp/tools_bianka.py`. No MCP server is needed.

From the repository root, with Python 3.11 and the shared virtual environment active:

```bash
python -m pip install -r gateway/requirements.txt
```

Configure `MGA_TOKEN` in the root `.env` or environment for live LLM requests.

```python
import json

from gateway.guardrails.guardrails import call_tool, initial_input_check, send_input_to_llm

request = "Analyze customer revenue concentration."
if initial_input_check(request) == "ALLOW":
    response = json.loads(send_input_to_llm(request))
    print(response["text"])
    for name in response["tools"]:
        contents = call_tool(name)
```

`initial_input_check` maps the existing input judge's `is_safe` boolean to
`ALLOW` or `REJECT`. `send_input_to_llm` sends all ten tool names and docstrings
using the existing LLM helper's tool-calling support. It returns JSON text with
`text` and `tools` (a list of tool names, possibly empty), without executing tools.
`call_tool` accepts only a registered name and returns the full file contents;
unknown names raise `ValueError` and file errors propagate to the caller.

Permission checks, output checks and end-to-end processing remain stubs.
Tool execution currently has no permission enforcement.

Run offline gateway tests from the repository root:

```bash
python -m unittest discover -s gateway/tests -v
```
