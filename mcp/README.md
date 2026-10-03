# Bianka MCP tools

`tools_bianka.py` defines ten MCP tools, one for each file in `../case_files`.
Each returns the complete UTF-8 contents as a Python string, including CSV and JSON
files. Paths resolve relative to the module, independent of the working directory.
The tools return raw fixtures, including restricted and test files, without filtering
or permission checks. They are not connected to the chatbot yet.

Use Python 3.11 or newer and the shared virtual environment at the repository root.
From the repository root, install dependencies and start the MCP server over stdio:

```bash
source .venv/bin/activate
python -m pip install -r mcp/requirements.txt
python mcp/tools_bianka.py
```

Tools use the [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x).
