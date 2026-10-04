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

    def test_input_check_rejects_sql_injection_even_when_judged_safe(self):
        with patch.object(
            self.guardrails.inference, "judge_user_input", return_value={"is_safe": True}
        ):
            decision = self.guardrails.initial_input_check(
                "Analyze revenue'; DROP TABLE customers; --"
            )
            self.assertEqual(decision, "REJECT")

    def test_output_check_allows_only_explicit_safe_result_and_records_usage(self):
        for result, expected in (
            ({"is_safe": True, "reason": "Safe", "total_tokens": 10, "cost": 0.001}, "ALLOW"),
            ({"is_safe": False, "reason": "Restricted disclosure"}, "REJECT"),
            ({}, "REJECT"),
            ({"is_safe": "true"}, "REJECT"),
        ):
            with (
                self.subTest(result=result),
                patch.object(self.guardrails, "_anonymize", return_value="Anonymized output") as anonymize,
                patch.object(self.guardrails.inference, "judge_llm_response", return_value=result) as judge,
                patch.object(self.guardrails, "_record_usage") as usage,
                patch.object(self.guardrails, "_record_llm_output_check") as record,
                patch.object(self.guardrails, "_log_event") as log,
            ):
                self.assertEqual(self.guardrails.llm_output_check("Original output"), expected)
                anonymize.assert_called_once_with("Original output")
                judge.assert_called_once_with("Anonymized output")
                usage.assert_called_once_with(result)
                record.assert_called_once_with(expected == "ALLOW", result.get("reason"))
                self.assertEqual(log.call_args.args[0], "llm_output")
                self.assertEqual(log.call_args.args[3:], (expected == "ALLOW", result.get("reason")))

    def test_output_check_records_and_propagates_evaluator_failure(self):
        with (
            patch.object(self.guardrails, "_anonymize", return_value="Output"),
            patch.object(self.guardrails.inference, "judge_llm_response", side_effect=ValueError("Failed")),
            patch.object(self.guardrails, "_record_usage") as usage,
            patch.object(self.guardrails, "_record_llm_output_check") as record,
            patch.object(self.guardrails, "_log_event") as log,
        ):
            with self.assertRaisesRegex(ValueError, "Failed"):
                self.guardrails.llm_output_check("Output")
            usage.assert_not_called()
            record.assert_called_once_with(False, "ValueError")
            self.assertEqual(log.call_args.args[0], "llm_output")
            self.assertEqual(log.call_args.args[3:], (False, "ValueError"))

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

    def test_exhausted_budget_omits_tool_definitions_and_keeps_history(self):
        history = [{"prompt": "Earlier question", "answer": "Earlier answer", "tool_results": []}]
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Answer", tool_calls=[]))]
        )
        with patch.object(
            self.guardrails.inference, "chat_completion", return_value=response
        ) as chat:
            self.guardrails.send_input_to_llm("Follow up", history=history, allow_tools=False)
        request = chat.call_args.kwargs
        self.assertIsNone(request["tools"])
        self.assertIn("No tool calls remain", request["messages"][0]["content"])
        self.assertEqual(request["messages"][1]["content"], "Earlier question")

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

    def test_summary_receives_original_question_and_named_results(self):
        results = [{"name": "get_kyc_status", "content": '{"status":"completed"}'}]
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="KYC is complete."))]
        )
        with patch.object(
            self.guardrails.inference, "chat_completion", return_value=response
        ) as chat:
            answer = self.guardrails.send_tool_results_to_llm("Is KYC complete?", results)
        self.assertEqual(answer, "KYC is complete.")
        request = chat.call_args.kwargs
        self.assertEqual(request["messages"][1]["content"], "Is KYC complete?")
        self.assertEqual(
            json.loads(request["messages"][2]["content"].split("\n", 1)[1]), results
        )
        self.assertNotIn("tools", request)

    def test_summary_handles_empty_model_response(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=None))]
        )
        with patch.object(self.guardrails.inference, "chat_completion", return_value=response):
            self.assertEqual(self.guardrails.send_tool_results_to_llm("Question", []), "")

    def test_history_is_available_to_selection_and_summary(self):
        history = [
            {
                "prompt": "Check KYC",
                "answer": "KYC is complete.",
                "tool_results": [{"name": "get_kyc_status", "content": "prior source data"}],
            }
        ]
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Answer", tool_calls=[]))]
        )
        for function, args in (
            (self.guardrails.send_input_to_llm, ("What about EBITDA?",)),
            (self.guardrails.send_tool_results_to_llm, ("What about EBITDA?", [])),
        ):
            with self.subTest(function=function.__name__):
                with patch.object(
                    self.guardrails.inference, "chat_completion", return_value=response
                ) as chat:
                    function(*args, history=history)
                messages = chat.call_args.kwargs["messages"]
                self.assertEqual(messages[1], {"role": "user", "content": "Check KYC"})
                self.assertIn("prior source data", messages[2]["content"])
                self.assertEqual(messages[3], {"role": "assistant", "content": "KYC is complete."})
                self.assertEqual(messages[4]["content"], "What about EBITDA?")
                if function is self.guardrails.send_input_to_llm:
                    self.assertEqual(len(chat.call_args.kwargs["tools"]), 10)

    def test_disabled_tools_are_omitted_from_selection(self):
        with patch.dict(os.environ, {"MCP_CONFIG": "get_kyc_status=false"}, clear=True):
            result, request = self.send_input(None, [])
        names = [tool["function"]["name"] for tool in request["tools"]]
        self.assertNotIn("get_kyc_status", names)
        self.assertEqual(len(request["tools"]), 9)

    def test_tool_access_check_follows_mcp_config(self):
        with patch.dict(os.environ, {"MCP_CONFIG": "get_kyc_status=false"}, clear=True):
            self.assertEqual(
                self.guardrails.tool_access_check("user-1", "get_kyc_status"), "REJECT"
            )
            self.assertEqual(
                self.guardrails.tool_access_check("user-1", "get_kyc_details"), "ALLOW"
            )

    def test_tool_access_check_defaults_to_allow_when_unconfigured(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                self.guardrails.tool_access_check("user-1", "get_kyc_status"), "ALLOW"
            )

    def test_tool_access_check_rejects_unknown_tool(self):
        self.assertEqual(self.guardrails.tool_access_check("user-1", "_read_file"), "REJECT")

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
