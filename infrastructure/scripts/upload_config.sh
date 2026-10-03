#!/usr/bin/env bash
# Uploads gateway/guardrails/config/initial_config.json to the ai-gateway-config DynamoDB table.
set -euo pipefail

REGION="eu-north-1"
TABLE_NAME="ai-gateway-config"
CONFIG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/gateway/guardrails/config/initial_config.json"

python3 - "$CONFIG_FILE" << 'PYEOF' > /tmp/ai-gateway-config-item.json
import json
import sys

with open(sys.argv[1]) as f:
    config = json.load(f)

def to_av(value):
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, str):
        return {"S": value}
    raise TypeError(f"Unsupported type for value: {value!r}")

item = {k: to_av(v) for k, v in config.items()}
print(json.dumps(item, indent=2))
PYEOF

aws dynamodb put-item \
  --region "$REGION" \
  --table-name "$TABLE_NAME" \
  --item file:///tmp/ai-gateway-config-item.json

echo "Uploaded $(basename "$CONFIG_FILE") to $TABLE_NAME (configId=$(python3 -c "import json;print(json.load(open('$CONFIG_FILE'))['configId'])"))"
