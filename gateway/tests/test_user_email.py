import importlib.util
import json
import unittest
from contextvars import ContextVar
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


@unittest.skipUnless(importlib.util.find_spec("fastapi"), "FastAPI is required")
class UserEmailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guardrails = MagicMock()
        config = SimpleNamespace(ConfigPoller=MagicMock(), get_num_tool_calls=lambda default: default)
        spec = importlib.util.spec_from_file_location(
            "email_gateway_test", Path(__file__).resolve().parents[1] / "main.py"
        )
        cls.gateway = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {
            "gateway.guardrails": SimpleNamespace(guardrails=cls.guardrails),
            "gateway.guardrails.config_poller": config,
            "dotenv": SimpleNamespace(load_dotenv=MagicMock()),
            spec.name: cls.gateway,
        }):
            spec.loader.exec_module(cls.gateway)

    def setUp(self):
        self.guardrails.reset_mock()
        self.guardrails.request_user_email = ContextVar("test_user_email", default="anonymous")
        self.guardrails.initial_input_check.side_effect = None
        self.guardrails.initial_input_check.return_value = "ALLOW"
        self.guardrails.send_input_to_llm.return_value = json.dumps(
            {"text": "", "tools": ["get_kyc_status"]}
        )
        self.guardrails.tool_access_check.return_value = "ALLOW"
        self.guardrails.call_tool.return_value = "source data"
        self.guardrails.send_tool_results_to_llm.return_value = "Answer"
        self.guardrails.total_tokens_spent = 0
        self.guardrails.total_cost_spent = 0.0

    def test_selected_email_reaches_tool_access_check(self):
        for email in ("bianka@test.com", "filip@test.com"):
            with self.subTest(email=email):
                self.guardrails.tool_access_check.reset_mock()
                request = self.gateway.ChatRequest(prompt="Question", user_email=email)
                response = self.gateway.chat(request)
                self.assertEqual(response.text, "Answer")
                self.guardrails.tool_access_check.assert_called_once_with(
                    user_id=email, tool_name="get_kyc_status"
                )

    def test_omitted_email_preserves_anonymous_requests(self):
        response = self.gateway.chat(self.gateway.ChatRequest(prompt="Question"))
        self.assertEqual(response.text, "Answer")
        self.guardrails.tool_access_check.assert_called_once_with(
            user_id="anonymous", tool_name="get_kyc_status"
        )

    def test_empty_email_is_rejected_by_request_validation(self):
        with self.assertRaises(ValueError):
            self.gateway.ChatRequest(prompt="Question", user_email="")

    def test_email_is_available_throughout_request_and_reset_afterwards(self):
        def check_input(prompt):
            self.assertEqual(self.guardrails.request_user_email.get(), "bianka@test.com")
            return "ALLOW"

        def check_summary(*args, **kwargs):
            self.assertEqual(self.guardrails.request_user_email.get(), "bianka@test.com")
            return "Answer"

        with (
            patch.object(self.guardrails, "initial_input_check", side_effect=check_input),
            patch.object(self.guardrails, "send_tool_results_to_llm", side_effect=check_summary),
        ):
            self.gateway.chat(self.gateway.ChatRequest(prompt="Question", user_email="bianka@test.com"))
        self.assertEqual(self.guardrails.request_user_email.get(), "anonymous")

    def test_email_is_reset_after_rejection_or_failure(self):
        for result in ("REJECT", ValueError("Failed"), RuntimeError("Missing token")):
            with self.subTest(result=result):
                def check_input(prompt):
                    self.assertEqual(self.guardrails.request_user_email.get(), "bianka@test.com")
                    if isinstance(result, Exception):
                        raise result
                    return result

                self.guardrails.initial_input_check.side_effect = check_input
                self.gateway.chat(
                    self.gateway.ChatRequest(prompt="Question", user_email="bianka@test.com")
                )
                self.assertEqual(self.guardrails.request_user_email.get(), "anonymous")


if __name__ == "__main__":
    unittest.main()
