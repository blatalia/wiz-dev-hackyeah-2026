import importlib
import inspect
import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class FakeFastMCP:
    def __init__(self, name):
        self.name = name

    def tool(self):
        return lambda function: function


class GuardrailsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Offline tests exercise gateway logic without installing provider SDKs.
        modules = {
            "openai": SimpleNamespace(OpenAI=object),
            "dotenv": SimpleNamespace(load_dotenv=lambda: None),
            "mcp": SimpleNamespace(),
            "mcp.server": SimpleNamespace(),
            "mcp.server.fastmcp": SimpleNamespace(FastMCP=FakeFastMCP),
        }
        with patch.dict("sys.modules", modules):
            cls.guardrails = importlib.import_module("gateway.guardrails.guardrails")

    def test_missing_mga_token_does_not_fall_back_to_another_api_key(self):
        inference = self.guardrails.inference
        with (
            patch.dict(os.environ, {"OPENAI_API_KEY": "unrelated-test-key"}, clear=True),
            patch.object(inference, "OpenAI") as client,
        ):
            with self.assertRaises(inference.LLMConfigurationError):
                inference.get_mga_client()
            client.assert_not_called()

    def test_mga_client_uses_explicit_environment_token(self):
        inference = self.guardrails.inference
        with (
            patch.dict(os.environ, {"MGA_TOKEN": "test-token"}, clear=True),
            patch.object(inference, "OpenAI") as client,
        ):
            inference.get_mga_client()
            client.assert_called_once_with(
                api_key="test-token", base_url="https://chat.int.bayer.com/api/v2"
            )

    def test_input_check_allows_only_explicit_safe_result(self):
        for result, expected in (
            ({"is_safe": True}, "ALLOW"),
            ({"is_safe": False}, "REJECT"),
            ({}, "REJECT"),
            ({"is_safe": "true"}, "REJECT"),
        ):
            with self.subTest(result=result):
                with patch.object(
                    self.guardrails.inference, "judge_user_input", return_value=result
                ) as judge:
                    decision = self.guardrails.initial_input_check("Analyze revenue")
                    self.assertEqual(decision, expected)
                    judge.assert_called_once_with("Analyze revenue")

    def send_input(self, content, tool_names):
        message = SimpleNamespace(
            content=content,
            tool_calls=[
                SimpleNamespace(function=SimpleNamespace(name=name)) for name in tool_names
            ],
        )
        response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
        with patch.object(
            self.guardrails.inference, "chat_completion", return_value=response
        ) as chat:
            result = json.loads(self.guardrails.send_input_to_llm("Analyze revenue"))
        return result, chat.call_args.kwargs

    def test_llm_receives_all_tool_descriptions_and_returns_selected_names(self):
        result, request = self.send_input(None, ["get_customer_revenue", "get_management_accounts"])
        self.assertEqual(
            result, {"text": "", "tools": ["get_customer_revenue", "get_management_accounts"]}
        )
        self.assertEqual(request["messages"][-1], {"role": "user", "content": "Analyze revenue"})
        self.assertEqual(len(request["tools"]), 10)
        for tool in request["tools"]:
            function = tool["function"]
            self.assertEqual(
                function["description"],
                inspect.getdoc(self.guardrails.TOOLS[function["name"]]),
            )
            self.assertEqual(function["parameters"]["properties"], {})

    def test_llm_can_return_text_without_tools(self):
        result, _ = self.send_input("Hello!", [])
        self.assertEqual(result, {"text": "Hello!", "tools": []})

    def test_llm_handles_missing_tool_calls(self):
        message = SimpleNamespace(content="Hello!", tool_calls=None)
        response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
        with patch.object(self.guardrails.inference, "chat_completion", return_value=response):
            result = json.loads(self.guardrails.send_input_to_llm("Hello"))
        self.assertEqual(result["tools"], [])

    def test_call_tool_returns_file_contents(self):
        source = Path(__file__).resolve().parents[2] / "case_files" / "08_KYC_Status_ALLOWED.json"
        self.assertEqual(
            self.guardrails.call_tool("get_kyc_status"), source.read_bytes().decode("utf-8")
        )

    def test_unknown_tool_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown tool"):
            self.guardrails.call_tool("_read_file")

    def test_tool_execution_errors_propagate(self):
        def missing_file():
            raise FileNotFoundError("Missing fixture")

        with patch.dict(self.guardrails.TOOLS, {"get_kyc_status": missing_file}):
            with self.assertRaises(FileNotFoundError):
                self.guardrails.call_tool("get_kyc_status")


if __name__ == "__main__":
    unittest.main()
