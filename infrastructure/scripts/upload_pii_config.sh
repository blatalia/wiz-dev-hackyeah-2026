#!/usr/bin/env bash
# Uploads config/pii_config.yml to the ai-gateway-config DynamoDB table as a
# categorized item (configId="default"), fully replacing the previous flat
# flags with three nested maps: pii_to_anonymize, mcp_config and
# input_validation.
#
# All boolean entries default to true (PII anonymization on / MCP tool
# enabled). num_tool_calls (inside mcp_config) defaults to 2.
# input_validation.max_tokens defaults to the value in the YAML file.
set -euo pipefail

REGION="eu-north-1"
TABLE_NAME="ai-gateway-config"
CONFIG_ID="default"
CONFIG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/config/pii_config.yml"
NUM_TOOL_CALLS_DEFAULT=2

python3 - "$CONFIG_FILE" "$CONFIG_ID" "$NUM_TOOL_CALLS_DEFAULT" << 'PYEOF' > /tmp/ai-gateway-config-item.json
import json
import sys

import yaml

config_file, config_id, num_tool_calls_default = sys.argv[1], sys.argv[2], int(sys.argv[3])

with open(config_file) as f:
    config = yaml.safe_load(f)

def bool_map(keys):
    return {"M": {key: {"BOOL": True} for key in keys}}

def int_map(mapping):
    return {"M": {key: {"N": str(value)} for key, value in mapping.items()}}

pii_keys = config["pii_to_anonymize"]
mcp_keys = [k for k in config["mcp_config"] if k != "num_tool_calls"]

mcp_map = {key: {"BOOL": True} for key in mcp_keys}
mcp_map["num_tool_calls"] = {"N": str(num_tool_calls_default)}

item = {
    "configId": {"S": config_id},
    "pii_to_anonymize": bool_map(pii_keys),
    "mcp_config": {"M": mcp_map},
    "input_validation": int_map(config.get("input_validation", {})),
}
print(json.dumps(item, indent=2))
PYEOF

aws dynamodb put-item \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --item file:///tmp/ai-gateway-config-item.json

echo "Uploaded $(basename "$CONFIG_FILE") to $TABLE_NAME (configId=$CONFIG_ID)"
