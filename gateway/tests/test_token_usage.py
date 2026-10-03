import importlib
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from gateway.tests.test_guardrails import FakeFastMCP


class TokenUsageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        modules = {
            "openai": SimpleNamespace(OpenAI=object),
            "dotenv": SimpleNamespace(load_dotenv=lambda: None),
            "mcp": SimpleNamespace(),
            "mcp.server": SimpleNamespace(),
            "mcp.server.fastmcp": SimpleNamespace(FastMCP=FakeFastMCP),
        }
        with patch.dict("sys.modules", modules):
            cls.guardrails = importlib.import_module("gateway.guardrails.guardrails")

    def setUp(self):
        counter = patch.object(self.guardrails, "total_tokens_spent", 0)
        counter.start()
        self.addCleanup(counter.stop)
        completion_patch = patch.object(self.guardrails.inference, "chat_completion")
        self.completion = completion_patch.start()
        self.addCleanup(completion_patch.stop)

    def response(self, tokens, content="Answer"):
        return SimpleNamespace(
            usage=SimpleNamespace(total_tokens=tokens),
            choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=[]))],
        )

    def test_counts_tool_selection_and_summaries_in_one_running_total(self):
        self.completion.side_effect = [self.response(10), self.response(20), self.response(30)]
        self.guardrails.send_input_to_llm("Question")
        self.assertEqual(self.guardrails.send_tool_results_to_llm("Question", []), "Answer")
        self.guardrails.send_input_to_llm("Follow up", allow_tools=False)
        self.assertEqual(self.guardrails.total_tokens_spent, 60)

    def test_missing_usage_does_not_break_chat_or_change_total(self):
        for usage in ("missing", None, SimpleNamespace(total_tokens=None)):
            with self.subTest(usage=usage):
                response = self.response(0)
                if usage == "missing":
                    del response.usage
                else:
                    response.usage = usage
                self.completion.return_value = response
                self.assertEqual(self.guardrails.send_tool_results_to_llm("Question", []), "Answer")
                self.assertEqual(self.guardrails.total_tokens_spent, 0)

    def test_failed_request_does_not_increment_total(self):
        self.completion.side_effect = RuntimeError("Provider unavailable")
        with self.assertRaises(RuntimeError):
            self.guardrails.send_input_to_llm("Question")
        self.assertEqual(self.guardrails.total_tokens_spent, 0)

    def test_tokens_are_counted_even_if_response_processing_fails(self):
        response = self.response(12)
        response.choices = []
        self.completion.return_value = response
        with self.assertRaises(IndexError):
            self.guardrails.send_input_to_llm("Question")
        self.assertEqual(self.guardrails.total_tokens_spent, 12)

    def test_concurrent_updates_accumulate(self):
        response = self.response(3)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(self.guardrails._record_token_usage, [response] * 1000))
        self.assertEqual(self.guardrails.total_tokens_spent, 3000)


if __name__ == "__main__":
    unittest.main()
