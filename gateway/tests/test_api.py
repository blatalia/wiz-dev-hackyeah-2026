import importlib
import importlib.util
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


@unittest.skipUnless(
    importlib.util.find_spec("fastapi") and importlib.util.find_spec("httpx"),
    "FastAPI and httpx are required for API tests",
)
class GatewayAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient

        cls.guardrails = MagicMock()
        with patch.dict(
            "sys.modules",
            {"gateway.guardrails": SimpleNamespace(guardrails=cls.guardrails)},
        ):
            module = importlib.import_module("gateway.main")
        cls.client = TestClient(module.app)

    def setUp(self):
        self.guardrails.reset_mock()
        self.guardrails.initial_input_check.return_value = "ALLOW"
        self.guardrails.initial_input_check.side_effect = None
        self.guardrails.send_input_to_llm.return_value = json.dumps(
            {"text": "Hello!", "tools": []}
        )
        self.guardrails.call_tool.side_effect = None

    def test_health_does_not_call_llm(self):
        response = self.client.get("/health")
        self.assertEqual(response.json(), {"status": "ok"})
        self.guardrails.initial_input_check.assert_not_called()

    def test_plain_text_answer(self):
        response = self.client.post("/chat", json={"prompt": "Hello"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "Hello!")
        self.assertTrue(response.headers["content-type"].startswith("text/plain"))
        self.guardrails.call_tool.assert_not_called()

    def test_selected_tools_are_called_and_results_returned(self):
        self.guardrails.send_input_to_llm.return_value = json.dumps(
            {"text": "", "tools": ["get_kyc_status"]}
        )
        self.guardrails.call_tool.return_value = '{"status":"completed"}'
        response = self.client.post("/chat", json={"prompt": "Check KYC status"})
        self.assertEqual(response.text, 'get_kyc_status:\n{"status":"completed"}')
        self.guardrails.call_tool.assert_called_once_with("get_kyc_status")

    def test_rejection_stops_before_tool_selection(self):
        self.guardrails.initial_input_check.return_value = "REJECT"
        response = self.client.post("/chat", json={"prompt": "Rejected request"})
        self.assertEqual(response.status_code, 403)
        self.guardrails.send_input_to_llm.assert_not_called()
        self.guardrails.call_tool.assert_not_called()

    def test_blank_and_invalid_requests_are_rejected(self):
        for body, status in (({"prompt": "   "}, 400), ({}, 422), ({"prompt": ""}, 422)):
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/chat", json=body).status_code, status)
        self.guardrails.initial_input_check.assert_not_called()

    def test_provider_error_is_not_exposed(self):
        self.guardrails.initial_input_check.side_effect = RuntimeError("private provider error")
        response = self.client.post("/chat", json={"prompt": "Hello"})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private provider error", response.text)

    def test_missing_token_returns_clear_configuration_error(self):
        from llm.inference import LLMConfigurationError

        self.guardrails.initial_input_check.side_effect = LLMConfigurationError("Missing token")
        response = self.client.post("/chat", json={"prompt": "Hello"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("MGA_TOKEN", response.text)
        self.guardrails.send_input_to_llm.assert_not_called()

    def test_tool_error_is_not_exposed(self):
        self.guardrails.send_input_to_llm.return_value = json.dumps(
            {"text": "", "tools": ["unknown"]}
        )
        self.guardrails.call_tool.side_effect = ValueError("Unknown tool")
        response = self.client.post("/chat", json={"prompt": "Analyze"})
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
