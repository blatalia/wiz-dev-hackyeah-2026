import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

load_dotenv(Path(__file__).resolve().parent / ".env")
gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
gemini_model = os.getenv("GEMINI_MODEL", "").strip() or "gemini-2.5-flash"

st.title("Agent")
st.caption("Corporate assistant")
if "messages" not in st.session_state:
    st.session_state["messages"] = [{"role": "assistant", "content": "How can I help you?"}]

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

if prompt := st.chat_input():
    if not gemini_api_key:
        st.info("Please set GEMINI_API_KEY in .env and restart the app.")
        st.stop()

    st.chat_message("user").write(prompt)
    # The initial greeting is UI text; send only the actual conversation to Gemini.
    messages = st.session_state.messages[1:] + [{"role": "user", "content": prompt}]
    contents = [
        types.Content(
            role="model" if message["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=message["content"])],
        )
        for message in messages
    ]
    try:
        with st.spinner("Thinking..."):
            with genai.Client(api_key=gemini_api_key, vertexai=False) as client:
                response = client.models.generate_content(model=gemini_model, contents=contents)
        msg = response.text
    except errors.APIError as exc:
        if exc.code == 429:
            st.error("Gemini's quota was exceeded. Please wait and try again.")
        else:
            st.error("Gemini could not respond. Check your API key and model, then try again.")
        st.stop()

    if not msg or not msg.strip():
        st.warning("Gemini returned no text. Try rephrasing your message.")
        st.stop()

    st.session_state.messages.append({"role": "user", "content": prompt})
    st.session_state.messages.append({"role": "assistant", "content": msg})
    st.chat_message("assistant").write(msg)
