import os
from openai import OpenAI
from dotenv import load_dotenv
import json

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


def judge_llm_response(content_to_check, model="gpt-4o"):
    """
    Evaluates the content for security risks.
    Returns a dict: {"is_safe": bool, "reason": str}
    """
    client = get_mga_client() # Uses your existing MGA client setup
    
    #TODO: DEFINE JUDGING CRITERIA 
    system_prompt = ("")
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Content to evaluate: {content_to_check}"}
    ]
    
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_object"} 
    )
    
    return json.loads(response.choices[0].message.content)


def judge_user_input(user_input, model="gpt-4o"):
    """
    Checks if user input is malicious or contains prompt injection.
    Returns: {"is_safe": bool, "reason": str}
    """
    client = get_mga_client()
    
    # TODO: DEFINE JUDGING CRITERIA 
    system_prompt = ("")
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"User input to analyze: {user_input}"}
    ]
    
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_object"}
    )
    
    return json.loads(response.choices[0].message.content)


def judge_tool_calls(tool_calls, model="gpt-4o"):
    # TODO: DEFINE TOOLS + TOOL CALLS JUDGING CRITERIA 
    pass
