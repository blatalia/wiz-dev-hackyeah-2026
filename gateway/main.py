"""Small HTTP gateway for the corporate assistant."""

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from gateway.guardrails import guardrails
from gateway.guardrails.config_poller import ConfigPoller, get_num_tool_calls

NUM_TOOL_CALLS_HARDCODE = 2


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    # Populates PII_TO_ANONYMIZE/MCP_CONFIG env vars synchronously before the
    # app starts serving requests, then keeps them in sync via a background poll.
    config_poller = None
    try:
        config_poller = ConfigPoller()
        config_poller.start()
    except Exception as exc:
        logger.warning(
            "Config loading failed (%s); using tool-call fallback of %s.",
            type(exc).__name__,
            NUM_TOOL_CALLS_HARDCODE,
        )
    try:
        yield
    finally:
        if config_poller is not None:
            config_poller.stop()


app = FastAPI(title="Agent gateway", lifespan=lifespan)
app.state.num_tool_calls = NUM_TOOL_CALLS_HARDCODE
logger = logging.getLogger("uvicorn.error")
TOOL_LIMIT_MESSAGE = (
    "The tool-call limit has been reached. I can use previously retrieved information, "
    "but can't retrieve more."
)


class ToolResult(BaseModel):
    name: str
    content: str


class ConversationTurn(BaseModel):
    prompt: str
    answer: str
    tool_results: list[ToolResult] = Field(default_factory=list)


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1)
    history: list[ConversationTurn] = Field(default_factory=list)
    user_email: str | None = Field(default=None, min_length=1)


class ChatResponse(BaseModel):
    text: str
    history: list[ConversationTurn]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    prompt = request.prompt.strip()
    if not prompt:
        return PlainTextResponse("Please enter a prompt.", status_code=400)

    stage = "input check"
    try:
        if guardrails.initial_input_check(prompt) != "ALLOW":
            return PlainTextResponse(
                "Your request was rejected by the input check.", status_code=403
            )

        stage = "LLM tool selection"
        history = [turn.model_dump() for turn in request.history]
        used_calls = sum(len(turn.tool_results) for turn in request.history)
        remaining_calls = max(0, get_num_tool_calls(app.state.num_tool_calls) - used_calls)
        result = json.loads(
            guardrails.send_input_to_llm(
                prompt, history=history, allow_tools=remaining_calls > 0
            )
        )
        text = result["text"]
        tool_results = []
        stage = "tool access check"
        denied_tools = [
            name
            for name in result["tools"]
            if guardrails.tool_access_check(
                user_id=request.user_email or "anonymous", tool_name=name
            ) != "ALLOW"
        ]
        if denied_tools:
            text = (
                "This request needs a tool that is currently disabled by configuration: "
                f"{', '.join(denied_tools)}. No tools were called. I can use previously "
                "retrieved information, or you can ask something else."
            )
        elif len(result["tools"]) > remaining_calls:
            if remaining_calls == 0:
                text = TOOL_LIMIT_MESSAGE
            else:
                text = (
                    "This request would exceed the tool-call limit. Remaining calls: "
                    f"{remaining_calls}. No tools were called. I can use previously retrieved "
                    "information, or you can ask for a smaller retrieval."
                )
        elif result["tools"]:
            stage = "tool execution"
            tool_results = [
                {"name": name, "content": guardrails.call_tool(name)}
                for name in result["tools"]
            ]
            stage = "LLM summary"
            text = guardrails.send_tool_results_to_llm(prompt, tool_results, history=history)
        if remaining_calls == len(tool_results) and not text.startswith(TOOL_LIMIT_MESSAGE):
            text = TOOL_LIMIT_MESSAGE + (f"\n\n{text}" if text else "")
        text = text or "The assistant returned no text."
        turn = ConversationTurn(prompt=prompt, answer=text, tool_results=tool_results)
        return ChatResponse(text=text, history=[*request.history, turn])
    except RuntimeError:
        logger.error("MGA_TOKEN is not set in the gateway process environment.")
        return PlainTextResponse(
            "The gateway is missing MGA_TOKEN. Set it in the server environment and restart.",
            status_code=503,
        )
    except Exception as exc:
        # Do not log prompts, tool contents, credentials or provider response bodies.
        logger.error(
            "Chat failed during %s: %s (HTTP status: %s)",
            stage,
            type(exc).__name__,
            getattr(exc, "status_code", None),
        )
        return PlainTextResponse("The gateway could not process your request.", status_code=502)
    finally:
        logger.info(
            "Total tokens spent: %s | Total cost: $%.8f",
            guardrails.total_tokens_spent,
            guardrails.total_cost_spent,
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
