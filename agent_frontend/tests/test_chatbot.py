import os
import runpy
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

MAIN = Path(__file__).resolve().parents[1] / "main.py"
GREETING = {"role": "assistant", "content": "How can I help you?"}


class StopScript(Exception):
    pass


class APIError(Exception):
    def __init__(self, code):
        self.code = code


class SessionState(dict):
    def __getattr__(self, name):
        return self[name]


class ChatbotTests(unittest.TestCase):
    def run_app(self, env=None, history=None, response="Hello!", error=None):
        st = MagicMock()
        st.session_state = SessionState(messages=[GREETING.copy(), *(history or [])])
        st.chat_input.return_value = "Hi"
        st.stop.side_effect = StopScript
        genai = MagicMock()
        client = genai.Client.return_value.__enter__.return_value
        client.models.generate_content.return_value = SimpleNamespace(text=response)
        client.models.generate_content.side_effect = error
        types = SimpleNamespace(
            Content=lambda **kwargs: SimpleNamespace(**kwargs),
            Part=SimpleNamespace(from_text=lambda **kwargs: SimpleNamespace(**kwargs)),
        )
        genai.types = types
        genai.errors = SimpleNamespace(APIError=APIError)
        dotenv = MagicMock()
        modules = {
            "streamlit": st,
            "dotenv": dotenv,
            "google": SimpleNamespace(genai=genai),
            "google.genai": genai,
        }
        with patch.dict(os.environ, env or {}, clear=True), patch.dict("sys.modules", modules):
            try:
                runpy.run_path(str(MAIN))
            except StopScript:
                pass
        return st, genai, client, dotenv

    def test_missing_key_stops_before_calling_google(self):
        st, genai, _, dotenv = self.run_app()
        genai.Client.assert_not_called()
        self.assertEqual(st.session_state.messages, [GREETING])
        dotenv.load_dotenv.assert_called_once_with(MAIN.parent / ".env")

    def test_sends_history_with_gemini_roles_and_excludes_ui_greeting(self):
        history = [
            {"role": "user", "content": "My name is Alex"},
            {"role": "assistant", "content": "Hello Alex"},
        ]
        st, genai, client, _ = self.run_app({"GEMINI_API_KEY": "test-key"}, history)
        genai.Client.assert_called_once_with(api_key="test-key", vertexai=False)
        request = client.models.generate_content.call_args.kwargs
        self.assertEqual(request["model"], "gemini-2.5-flash")
        self.assertEqual([part.role for part in request["contents"]], ["user", "model", "user"])
        self.assertEqual(
            [part.parts[0].text for part in request["contents"]],
            ["My name is Alex", "Hello Alex", "Hi"],
        )
        self.assertEqual(st.session_state.messages[-1]["content"], "Hello!")

    def test_environment_can_override_model(self):
        _, _, client, _ = self.run_app(
            {"GEMINI_API_KEY": "test-key", "GEMINI_MODEL": "custom-model"}
        )
        self.assertEqual(client.models.generate_content.call_args.kwargs["model"], "custom-model")

    def test_api_failures_preserve_history_and_do_not_display_key(self):
        for code in (429, 403, 503):
            with self.subTest(code=code):
                st, _, _, _ = self.run_app({"GEMINI_API_KEY": "test-key"}, error=APIError(code))
                st.error.assert_called_once()
                self.assertNotIn("test-key", st.error.call_args.args[0])
                self.assertEqual(st.session_state.messages, [GREETING])

    def test_empty_response_preserves_history(self):
        for response in (None, "", "   "):
            with self.subTest(response=response):
                st, _, _, _ = self.run_app({"GEMINI_API_KEY": "test-key"}, response=response)
                st.warning.assert_called_once()
                self.assertEqual(st.session_state.messages, [GREETING])


if __name__ == "__main__":
    unittest.main()
