import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

MAIN = Path(__file__).resolve().parents[1] / "main.py"
GREETING = {"role": "assistant", "content": "How can I help you?"}


class StopScript(Exception):
    pass


class SessionState(dict):
    def __getattr__(self, name):
        return self[name]

    def __setattr__(self, name, value):
        self[name] = value


class ChatbotTests(unittest.TestCase):
    def run_app(self, env=None, history=None, text="Hello!", error=None, conversation=None):
        st = MagicMock()
        st.session_state = SessionState(messages=[GREETING.copy(), *(history or [])])
        st.session_state["history"] = conversation or []
        st.chat_input.return_value = "Hi"
        st.stop.side_effect = StopScript
        response = MagicMock(text=text)
        response.json.return_value = {
            "text": text,
            "history": [
                *(conversation or []),
                {"prompt": "Hi", "answer": text, "tool_results": []},
            ],
        }
        with (
            patch.dict(os.environ, env or {}, clear=True),
            patch.dict("sys.modules", {"streamlit": st}),
            patch.object(requests, "post", return_value=response, side_effect=error) as post,
        ):
            try:
                runpy.run_path(str(MAIN))
            except StopScript:
                pass
        return st, post

    def test_sends_prompt_to_gateway_and_displays_plain_text(self):
        st, post = self.run_app()
        post.assert_called_once_with(
            "http://localhost:8000/chat",
            json={"prompt": "Hi", "history": []},
            timeout=(5, 120),
        )
        st.spinner.assert_called_once_with("Thinking...")
        self.assertEqual(st.session_state.messages[-1]["content"], "Hello!")
        st.chat_message.return_value.write.assert_any_call("Hello!")

    def test_gateway_url_can_be_configured_for_containers(self):
        _, post = self.run_app(env={"GATEWAY_URL": "http://gateway:8000/"})
        self.assertEqual(post.call_args.args[0], "http://gateway:8000/chat")

    def test_network_error_preserves_history(self):
        st, _ = self.run_app(error=requests.ConnectionError("Unavailable"))
        st.error.assert_called_once_with("Could not reach the gateway. Please try again.")
        self.assertEqual(st.session_state.messages, [GREETING])

    def test_rejected_request_displays_gateway_response(self):
        response = MagicMock(text="Your request was rejected by the input check.")
        error = requests.HTTPError(response=response)
        st, _ = self.run_app(error=error)
        st.error.assert_called_once_with(response.text)
        self.assertEqual(st.session_state.messages, [GREETING])

    def test_empty_response_preserves_history(self):
        st, _ = self.run_app(text="   ")
        st.warning.assert_called_once()
        self.assertEqual(st.session_state.messages, [GREETING])

    def test_followup_sends_and_retains_previous_tool_results(self):
        conversation = [
            {
                "prompt": "Check KYC",
                "answer": "KYC is complete.",
                "tool_results": [{"name": "get_kyc_status", "content": "source data"}],
            }
        ]
        st, post = self.run_app(conversation=conversation)
        self.assertEqual(post.call_args.kwargs["json"]["history"], conversation)
        self.assertEqual(st.session_state.history[0], conversation[0])
        self.assertEqual(len(st.session_state.history), 2)

    def test_failed_turn_does_not_change_retained_history(self):
        conversation = [{"prompt": "Hello", "answer": "Hello!", "tool_results": []}]
        st, _ = self.run_app(conversation=conversation, error=requests.ConnectionError())
        self.assertEqual(st.session_state.history, conversation)


if __name__ == "__main__":
    unittest.main()
