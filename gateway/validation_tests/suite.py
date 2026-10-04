"""Run production guardrail functions directly, without importing gateway.main."""

import importlib
import json
import logging
import os
from collections import Counter
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from textwrap import wrap
from typing import Any
from unittest.mock import patch

from .cases import CASES, ValidationCase


@dataclass(frozen=True)
class ValidationResult:
    case: ValidationCase
    output: Any
    status: str


class MissingCredentials(RuntimeError):
    """A case cannot run without these exported environment variables."""


def error_description(error: Exception) -> str:
    if isinstance(error, MissingCredentials):
        return str(error)
    if isinstance(error, ModuleNotFoundError):
        return f"Missing dependency: {error.name}"
    # Provider exception messages can contain request details. Report only type.
    return f"ERROR: {type(error).__name__}"


@contextmanager
def validation_runtime():
    with ExitStack() as stack:
        # Imports and PII detection normally call load_dotenv. Validation uses
        # only runtime credentials and never opens private .env files.
        stack.enter_context(patch("dotenv.load_dotenv", return_value=False))
        guardrails = importlib.import_module("gateway.guardrails.guardrails")
        stack.enter_context(patch("llm.inference.load_dotenv", return_value=False))
        stack.enter_context(patch("anonymization_utils.eu_pii.load_dotenv", return_value=False))
        # Validation should not append synthetic traffic to production metrics.
        stack.enter_context(patch.object(guardrails, "_log_event"))
        stack.enter_context(patch.object(guardrails, "_log_sql_check"))
        stack.enter_context(patch.dict(os.environ, {
            "MCP_CONFIG": "",
            "INPUT_VALIDATION": "",
            "PII_TO_ANONYMIZE": "EMAIL",
        }))
        for name in ("httpx", "httpcore", "openai"):
            logger = logging.getLogger(name)
            stack.callback(logger.setLevel, logger.level)
            logger.setLevel(logging.WARNING)
        yield guardrails


@contextmanager
def observe_llm_requests(inference):
    """Observe real provider calls, distinguishing service errors from rejection.

    Inference judges return is_safe=False on provider failure. A negative case
    must not pass just because authentication or the network is broken.
    """
    calls = []
    errors = []
    original_get_client = inference.get_mga_client
    with ExitStack() as stack:
        def get_client():
            base_client = original_get_client()
            stack.callback(base_client.close)
            client = base_client.with_options(timeout=30, max_retries=0)
            stack.callback(client.close)
            create = client.chat.completions.create

            def observed_create(**kwargs):
                calls.append(kwargs)
                try:
                    response = create(**kwargs)
                    if kwargs.get("response_format") == {"type": "json_object"}:
                        verdict = json.loads(response.choices[0].message.content)
                        if not isinstance(verdict, dict) or type(verdict.get("is_safe")) is not bool or not isinstance(verdict.get("reason"), str):
                            raise ValueError("The evaluator returned an invalid verdict.")
                    return response
                except Exception as exc:
                    errors.append(exc)
                    raise

            stack.enter_context(patch.object(client.chat.completions, "create", observed_create))
            return client

        stack.enter_context(patch.object(inference, "get_mga_client", get_client))
        yield calls, errors


def run_case(case: ValidationCase, guardrails) -> ValidationResult:
    try:
        missing = [name for name in case.credentials if not os.environ.get(name)]
        if missing:
            raise MissingCredentials("Missing runtime vars: " + ", ".join(missing))
        with patch.dict(os.environ, case.env), observe_llm_requests(guardrails.inference) as (calls, errors):
            if case.guardrail == "sql_detection":
                output = guardrails._sql_detector.is_sql(case.input)
            elif case.guardrail == "tool_access_check":
                user_id, tool_name = (part.strip() for part in case.input.split("/", 1))
                output = guardrails.tool_access_check(user_id, tool_name)
            elif case.guardrail == "pii_anonymization":
                output = guardrails._anonymize(case.input)
            elif case.guardrail == "response_token_cap":
                result = guardrails.send_input_to_llm(case.input, allow_tools=False)
                if not result or not calls:
                    raise RuntimeError("No LLM request was made.")
                output = calls[-1].get("max_tokens")
            else:
                output = getattr(guardrails, case.guardrail)(case.input)
            if errors:
                raise errors[0]
        status = "PASS" if type(output) is type(case.expected) and output == case.expected else "FAIL"
        return ValidationResult(case, output, status)
    except Exception as exc:
        return ValidationResult(case, error_description(exc), "ERROR")


def run_suite(*, local_only: bool = False) -> list[ValidationResult]:
    results = []
    with ExitStack() as stack:
        guardrails = None
        setup_error = None
        for case in CASES:
            if local_only and case.credentials:
                results.append(ValidationResult(case, "Requires live services", "SKIP"))
            else:
                if guardrails is None and setup_error is None:
                    try:
                        guardrails = stack.enter_context(validation_runtime())
                    except Exception as exc:
                        setup_error = error_description(exc)
                if setup_error is not None:
                    results.append(ValidationResult(case, setup_error, "ERROR"))
                else:
                    results.append(run_case(case, guardrails))
    return results


def display(value: Any) -> str:
    return str(value).replace("\r", "\\r").replace("\t", "\\t")


def render_table(results: list[ValidationResult]) -> str:
    headers = ("Guardrail", "Input", "Output", "Expected", "Type", "Result")
    rows = [
        (result.case.guardrail,
         result.case.input + ("\nGuardrail is off" if result.case.guardrail_off else ""),
         display(result.output),
         display(result.case.expected), result.case.type, result.status)
        for result in results
    ]
    caps = (22, 42, 28, 28, 8, 6)
    widths = [
        min(cap, max(len(header), *(len(line) for row in rows for line in row[index].splitlines())))
        if rows else len(header)
        for index, (header, cap) in enumerate(zip(headers, caps))
    ]
    border = "+" + "+".join("-" * (width + 2) for width in widths) + "+"

    def formatted(row):
        cells = [
            [part for line in (cell.splitlines() or [""]) for part in (wrap(line, width) or [""])]
            for cell, width in zip(row, widths)
        ]
        return [
            "| " + " | ".join((cell[index] if index < len(cell) else "").ljust(width)
                             for cell, width in zip(cells, widths)) + " |"
            for index in range(max(map(len, cells)))
        ]

    lines = [border, *formatted(headers), border]
    for row in rows:
        lines.extend(formatted(row))
        lines.append(border)
    return "\n".join(lines)


def summarize(results: list[ValidationResult]) -> str:
    counts = Counter(result.status for result in results)
    return " | ".join(f"{counts[status]} {status}" for status in ("PASS", "FAIL", "ERROR", "SKIP"))


def exit_code(results: list[ValidationResult]) -> int:
    return int(any(result.status in ("FAIL", "ERROR") for result in results))
