import asyncio
import importlib
import importlib.util
import json
import os
import unittest
from unittest.mock import MagicMock, patch


@unittest.skipUnless(importlib.util.find_spec("fastapi"), "FastAPI is required")
class ToolLimitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch("dotenv.load_dotenv"), patch.dict("sys.modules", {"boto3": MagicMock()}):
            cls.gateway = importlib.import_module("gateway.main")

    def setUp(self):
        env_patch = patch.dict(os.environ, {}, clear=True)
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self._patch(self.gateway.app.state, "num_tool_calls", 3)
        self._patch(self.gateway.guardrails, "initial_input_check", return_value="ALLOW")
        self.select = self._patch(self.gateway.guardrails, "send_input_to_llm")
        self.tool = self._patch(
            self.gateway.guardrails, "call_tool", return_value="source data"
        )
        self.summary = self._patch(
            self.gateway.guardrails, "send_tool_results_to_llm", return_value="Summary"
        )

    def _patch(self, *args, **kwargs):
        patcher = patch.object(*args, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def request(self, used, requested, text="Answer"):
        self.select.return_value = json.dumps({"text": text, "tools": requested})
        history = [
            {
                "prompt": "Earlier question",
                "answer": "Earlier answer",
                "tool_results": [
                    {"name": "get_kyc_status", "content": "old source"} for _ in range(used)
                ],
            }
        ] if used else []
        return self.gateway.chat(self.gateway.ChatRequest(prompt="Follow up", history=history))

    def test_batch_can_use_last_remaining_call(self):
        response = self.request(2, ["get_kyc_status"])
        self.tool.assert_called_once_with("get_kyc_status")
        self.assertIn("Summary", response.text)
        self.assertIn("tool-call limit has been reached", response.text)
        self.assertEqual(sum(len(turn.tool_results) for turn in response.history), 3)

    def test_exhausted_budget_still_allows_answers_from_history(self):
        response = self.request(3, [], text="Remembered answer")
        self.assertFalse(self.select.call_args.kwargs["allow_tools"])
        self.tool.assert_not_called()
        self.assertIn("Remembered answer", response.text)
        self.assertIn("can't retrieve more", response.text)

    def test_model_requested_tools_are_blocked_after_exhaustion(self):
        response = self.request(4, ["get_kyc_status"])
        self.tool.assert_not_called()
        self.summary.assert_not_called()
        self.assertEqual(response.text, self.gateway.TOOL_LIMIT_MESSAGE)
        self.assertEqual(response.history[-1].tool_results, [])

    def test_oversized_batch_is_blocked_before_any_execution(self):
        response = self.request(2, ["get_kyc_status", "get_hr_aggregate"])
        self.tool.assert_not_called()
        self.summary.assert_not_called()
        self.assertIn("Remaining calls: 1", response.text)
        self.assertEqual(sum(len(turn.tool_results) for turn in response.history), 2)

    def test_zero_limit_disables_tools_from_the_first_turn(self):
        self.gateway.app.state.num_tool_calls = 0
        response = self.request(0, [])
        self.assertFalse(self.select.call_args.kwargs["allow_tools"])
        self.tool.assert_not_called()
        self.assertIn("can't retrieve more", response.text)

    def test_new_conversation_has_a_fresh_allowance(self):
        response = self.request(0, ["get_kyc_status"])
        self.assertTrue(self.select.call_args.kwargs["allow_tools"])
        self.tool.assert_called_once()
        self.assertEqual(response.text, "Summary")

    def test_dynamic_limit_overrides_fallback(self):
        with patch.dict(os.environ, {"GATEWAY_CHECK_NUM_TOOL_CALLS": "1"}):
            response = self.request(1, [])
        self.assertFalse(self.select.call_args.kwargs["allow_tools"])
        self.assertIn("can't retrieve more", response.text)

    def test_missing_or_invalid_dynamic_limit_uses_hardcoded_two(self):
        self.gateway.app.state.num_tool_calls = self.gateway.NUM_TOOL_CALLS_HARDCODE
        for value in ("", "bad", "-1", "true", "1.5"):
            with self.subTest(value=value), patch.dict(
                os.environ, {"GATEWAY_CHECK_NUM_TOOL_CALLS": value}
            ):
                response = self.request(2, [])
                self.assertFalse(self.select.call_args.kwargs["allow_tools"])
                self.assertIn("can't retrieve more", response.text)

    def test_startup_succeeds_when_dynamic_config_loading_fails(self):
        async def startup():
            async with self.gateway.lifespan(self.gateway.app):
                return True

        with (
            patch.object(self.gateway, "load_dotenv"),
            patch.object(self.gateway, "ConfigPoller", side_effect=RuntimeError("Unavailable")),
            self.assertLogs("uvicorn.error", level="WARNING"),
        ):
            self.assertTrue(asyncio.run(startup()))


class ConfigPollerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict("sys.modules", {"boto3": MagicMock()}):
            cls.config = importlib.import_module("gateway.guardrails.config_poller")

    def setUp(self):
        env_patch = patch.dict(os.environ, {}, clear=True)
        env_patch.start()
        self.addCleanup(env_patch.stop)
        self.client = MagicMock()
        with patch.object(self.config.boto3, "client", return_value=self.client):
            self.poller = self.config.ConfigPoller()

    def test_numeric_limit_and_existing_boolean_flags_are_loaded(self):
        self.client.get_item.return_value = {
            "Item": {"num_tool_calls": {"N": "4"}, "email": {"BOOL": False}}
        }
        self.poller._poll_once(raise_on_error=False)
        self.assertEqual(self.config.get_num_tool_calls(), 4)
        self.assertFalse(self.config.get_check_enabled("email"))

    def test_failed_initial_load_keeps_fallback_and_starts_polling(self):
        self.client.get_item.side_effect = RuntimeError("Unavailable")
        with (
            patch.object(self.config.threading, "Thread") as thread,
            self.assertLogs(self.config.__name__, level="WARNING"),
        ):
            self.poller.start()
        thread.return_value.start.assert_called_once()
        self.assertEqual(self.config.get_num_tool_calls(), 2)

    def test_failed_poll_keeps_last_known_good_limit(self):
        self.client.get_item.return_value = {"Item": {"num_tool_calls": {"N": "4"}}}
        self.poller._poll_once(raise_on_error=False)
        self.client.get_item.side_effect = RuntimeError("Unavailable")
        with self.assertLogs(self.config.__name__, level="WARNING"):
            self.poller._poll_once(raise_on_error=False)
        self.assertEqual(self.config.get_num_tool_calls(), 4)

    def test_invalid_dynamic_limit_uses_fallback(self):
        for attribute in ({"BOOL": True}, {"N": "-1"}, {"N": "1.5"}, {}):
            with self.subTest(attribute=attribute):
                self.client.get_item.return_value = {"Item": {"num_tool_calls": attribute}}
                self.poller._poll_once(raise_on_error=False)
                self.assertEqual(self.config.get_num_tool_calls(), 2)


if __name__ == "__main__":
    unittest.main()
