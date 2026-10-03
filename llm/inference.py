import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

def get_mga_client():
    return OpenAI(
        api_key=os.getenv("MGA_TOKEN"),
        base_url="https://chat.int.bayer.com/api/v2" 
    )

def chat_completion(messages, tools=None, model="gpt-4o"):
    client = get_mga_client()
    
    params = {
        "model": model,
        "messages": messages,
    }
    
    if tools:
        params["tools"] = tools
        params["tool_choice"] = "auto"

    response = client.chat.completions.create(**params)
    return response

## EXAMPLE USAGE WITH SYSTEM PROMPT & PERSISTENCE ##

# 1. Initialize with a system prompt
# conversation_history = [
#     {"role": "system", "content": "You are a helpful assistant specialized in weather reports for Europe."}
# ]

# # 2. First turn
# user_input = "What is the weather in Berlin?"
# conversation_history.append({"role": "user", "content": user_input})

# response = chat_completion(conversation_history)
# answer = response.choices[0].message.content
# print(f"Assistant: {answer}")

# # 3. Add assistant response to history to maintain context
# conversation_history.append({"role": "assistant", "content": answer})

# # 4. Second turn (the model remembers the system prompt and the previous question)
# conversation_history.append({"role": "user", "content": "And in Munich?"})
# response = chat_completion(conversation_history)
# print(f"Assistant: {response.choices[0].message.content}")
