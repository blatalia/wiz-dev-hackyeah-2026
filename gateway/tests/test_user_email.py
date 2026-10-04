import importlib.util
import json
import unittest
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


if __name__ == "__main__":
    unittest.main()
