import os

import requests
import streamlit as st

gateway_url = os.getenv("GATEWAY_URL", "http://localhost:8000").rstrip("/")

st.title("Agent")
st.caption("Corporate assistant")
if "messages" not in st.session_state:
    st.session_state["messages"] = [{"role": "assistant", "content": "How can I help you?"}]

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

if prompt := st.chat_input():
    st.chat_message("user").write(prompt)
    try:
        with st.spinner("Thinking..."):
            response = requests.post(
                f"{gateway_url}/chat", json={"prompt": prompt}, timeout=(5, 120)
            )
            response.raise_for_status()
        msg = response.text
    except requests.RequestException as exc:
        if exc.response is not None:
            st.error(exc.response.text or "The gateway could not process your request.")
        else:
            st.error("Could not reach the gateway. Please try again.")
        st.stop()

    if not msg or not msg.strip():
        st.warning("The gateway returned no text. Try rephrasing your message.")
        st.stop()

    st.session_state.messages.append({"role": "user", "content": prompt})
    st.session_state.messages.append({"role": "assistant", "content": msg})
    st.chat_message("assistant").write(msg)
