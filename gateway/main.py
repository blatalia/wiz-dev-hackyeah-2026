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
from llm.inference import LLMConfigurationError

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    yield


app = FastAPI(title="Agent gateway", lifespan=lifespan)
logger = logging.getLogger("uvicorn.error")


class ChatRequest(BaseModel):
    prompt: str = Field(min_length=1)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_class=PlainTextResponse)
def chat(request: ChatRequest) -> PlainTextResponse:
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
        result = json.loads(guardrails.send_input_to_llm(prompt))
        parts = [result["text"]] if result["text"] else []
        for name in result["tools"]:
            stage = "tool execution"
            parts.append(f"{name}:\n{guardrails.call_tool(name)}")
        text = "\n\n".join(parts) or "The assistant returned no text."
        return PlainTextResponse(text)
    except LLMConfigurationError:
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
