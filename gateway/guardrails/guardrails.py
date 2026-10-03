"""Function stubs for the gateway's guardrail and request processing stages."""

from typing import Any, Literal, TypeAlias


GATEWAY_DECISION: TypeAlias = Literal["ALLOW", "REJECT"]


def initial_input_check(user_input: str) -> GATEWAY_DECISION:
    """Check incoming content, including potential prompt injection."""
    pass


def send_input_to_llm(user_input: str) -> str:
    """Send the checked input to the LLM."""
    pass


def llm_output_check(llm_output: str) -> GATEWAY_DECISION:
    """Check LLM output for PII, addresses and financial values."""
    pass


def tool_access_check(user_id: str, tool_name: str) -> GATEWAY_DECISION:
    """Check MCP tool permissions using configuration storage."""
    pass


def call_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Call a tool after the agent's permissions have been checked."""
    pass


def tool_output_check(tool_output: Any) -> GATEWAY_DECISION:
    """Validate tool results, including checking for errors."""
    pass


def send_tool_results_to_llm(tool_results: list[Any]) -> str:
    """Pass checked tool results back to the LLM."""
    pass


def process_request(user_id: str, user_input: str) -> str:
    """Process a request through the complete gateway pipeline."""
    pass
