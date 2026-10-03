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

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    yield


app = FastAPI(title="Agent gateway", lifespan=lifespan)
logger = logging.getLogger("uvicorn.error")


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
        result = json.loads(guardrails.send_input_to_llm(prompt, history=history))
        text = result["text"]
        tool_results = []
        if result["tools"]:
            stage = "tool execution"
            tool_results = [
                {"name": name, "content": guardrails.call_tool(name)}
                for name in result["tools"]
            ]
            stage = "LLM summary"
            text = guardrails.send_tool_results_to_llm(prompt, tool_results, history=history)
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
