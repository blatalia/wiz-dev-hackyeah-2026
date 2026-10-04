"""Background poller that mirrors the ai-gateway-config DynamoDB item into
environment variables, so guardrail functions always see live config without
needing a restart or an explicit DynamoDB call per request.

The DynamoDB item (configId="default") has three nested maps:
    {
      "configId": "default",
      "pii_to_anonymize": {"ACCOUNT_NUMBER": true, "EMAIL": false, ...},
      "input_validation": {"max_tokens": 10000},
      "mcp_config": {
        "default":         {"get_customer_contract_c014": true, ..., "num_tool_calls": 2},
        "bianka@test.com": {"get_customer_contract_c014": true, ..., "num_tool_calls": 2},
        "filip@test.com":  {"get_customer_contract_c014": false, ..., "num_tool_calls": 2},
      },
    }

mcp_config is keyed by user email, so each user can have a different set of
enabled tools / tool-call limit (role-based access). A "default" entry acts
as the fallback for any email not explicitly listed (including anonymous
requests). These are mirrored into three environment variables:
    PII_TO_ANONYMIZE="ACCOUNT_NUMBER,ADDRESS,..."     # only keys that are true
    INPUT_VALIDATION="max_tokens=10000"               # every key
    MCP_CONFIG='{"default": {"get_customer_contract_c014": true, ...}, "bianka@test.com": {...}, ...}'

For backward compatibility, MCP_CONFIG may also be set to the legacy flat
comma-separated format ("get_customer_contract_c014=true,...") which is
treated as a single shared config applied to every user.

Usage:
    from gateway.guardrails.config_poller import ConfigPoller

    poller = ConfigPoller()
    poller.start()  # does a synchronous initial load, then polls in background
    ...
    os.environ["PII_TO_ANONYMIZE"]
    os.environ["MCP_CONFIG"]
    os.environ["INPUT_VALIDATION"]
    ...
    poller.stop()
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Final

import boto3

logger = logging.getLogger(__name__)

PII_ENV_VAR: Final[str] = "PII_TO_ANONYMIZE"
MCP_ENV_VAR: Final[str] = "MCP_CONFIG"
INPUT_VALIDATION_ENV_VAR: Final[str] = "INPUT_VALIDATION"

DEFAULT_TABLE_NAME: Final[str] = "ai-gateway-config"
DEFAULT_CONFIG_ID: Final[str] = "default"
DEFAULT_REGION: Final[str] = "eu-north-1"
DEFAULT_POLL_INTERVAL_SECONDS: Final[float] = 60.0
DEFAULT_NUM_TOOL_CALLS: Final[int] = 2
DEFAULT_MAX_TOKENS: Final[int] = 10000
DEFAULT_MCP_USER_KEY: Final[str] = "default"


def get_pii_to_anonymize() -> list[str]:
    """Return the PII categories currently enabled for anonymization."""
    raw = os.environ.get(PII_ENV_VAR, "")
    return [item for item in raw.split(",") if item]


def is_pii_type_enabled(pii_type: str, default: bool = True) -> bool:
    """Check whether a single PII category is currently enabled for anonymization.

    Call this at the point of use (not once at import time) so that
    functions always observe the latest value the poller has written.
    """
    raw = os.environ.get(PII_ENV_VAR)
    if raw is None:
        return default
    return pii_type in raw.split(",")


def _stringify_mcp_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def get_mcp_config(user_email: str | None = None) -> dict[str, str]:
    """Return the MCP tool config for a user, as raw strings keyed by name.

    MCP_CONFIG is normally a JSON object keyed by user email (with a
    "default" fallback entry for any email not explicitly listed). For
    backward compatibility, a legacy flat "key=value,key=value" string is
    also accepted and applied the same way to every user.
    """
    raw = os.environ.get(MCP_ENV_VAR, "").strip()
    if not raw:
        return {}

    if raw.startswith("{"):
        try:
            by_user = json.loads(raw)
        except ValueError:
            logger.warning("Could not parse %s as JSON, ignoring", MCP_ENV_VAR)
            return {}
        user_map = None
        if user_email is not None:
            user_map = by_user.get(user_email)
        if user_map is None:
            user_map = by_user.get(DEFAULT_MCP_USER_KEY, {})
        return {key: _stringify_mcp_value(value) for key, value in user_map.items()}

    # Legacy flat format: one shared config applied to every user.
    entries: dict[str, str] = {}
    for pair in raw.split(","):
        key, sep, value = pair.partition("=")
        if sep:
            entries[key] = value
    return entries


def is_tool_enabled(tool_name: str, user_email: str | None = None, default: bool = True) -> bool:
    """Check whether a single MCP tool is currently enabled for a user."""
    raw = get_mcp_config(user_email).get(tool_name)
    if raw is None:
        return default
    return raw == "true"


def get_num_tool_calls(user_email: str | None = None, default: int = DEFAULT_NUM_TOOL_CALLS) -> int:
    """Read the latest tool-call limit for a user, falling back when absent or invalid."""
    raw = get_mcp_config(user_email).get("num_tool_calls", "")
    return int(raw) if raw.isdecimal() else default


def get_input_validation_config() -> dict[str, str]:
    """Return every INPUT_VALIDATION entry as raw strings, keyed by name."""
    raw = os.environ.get(INPUT_VALIDATION_ENV_VAR, "")
    entries: dict[str, str] = {}
    for pair in raw.split(","):
        key, sep, value = pair.partition("=")
        if sep:
            entries[key] = value
    return entries


def get_max_tokens(default: int = DEFAULT_MAX_TOKENS) -> int:
    """Read the latest max_tokens cap, falling back when absent or invalid."""
    raw = get_input_validation_config().get("max_tokens", "")
    return int(raw) if raw.isdecimal() else default


class ConfigPoller:
    """Polls a DynamoDB config item on an interval and syncs it to os.environ.

    Safe to use from a single process/container. Each poll is a single
    DynamoDB GetItem (eventually consistent) against a <1KB item, so even at
    a 60s interval this is ~43K requests/month per container - far under the
    DynamoDB Free Tier's 25 provisioned RCU (equivalent to ~1.3M eventually
    consistent reads/month).
    """

    def __init__(
        self,
        table_name: str = DEFAULT_TABLE_NAME,
        config_id: str = DEFAULT_CONFIG_ID,
        region_name: str = DEFAULT_REGION,
        poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    ) -> None:
        self._table_name = table_name
        self._config_id = config_id
        self._region_name = region_name
        self._poll_interval_seconds = poll_interval_seconds

        self._client = boto3.client("dynamodb", region_name=region_name)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._last_known_good: dict[str, str] = {}

    def start(self) -> None:
        """Load config synchronously once, then start background polling."""
        self._poll_once(raise_on_error=False)
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="ai-gateway-config-poller",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "Started config poller for table=%s configId=%s interval=%ss",
            self._table_name,
            self._config_id,
            self._poll_interval_seconds,
        )

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self._poll_interval_seconds)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            if self._stop_event.wait(self._poll_interval_seconds):
                break
            self._poll_once(raise_on_error=False)

    @staticmethod
    def _attribute_value_to_str(attribute_value: dict[str, object]) -> str | None:
        """Render a single DynamoDB attribute value as a MCP_CONFIG-style string."""
        if "BOOL" in attribute_value:
            return "true" if attribute_value["BOOL"] else "false"
        if "N" in attribute_value:
            return str(attribute_value["N"])
        return None

    @staticmethod
    def _attribute_value_to_native(attribute_value: dict[str, object]) -> bool | int | None:
        """Render a single DynamoDB attribute value as a native bool/int."""
        if "BOOL" in attribute_value:
            return bool(attribute_value["BOOL"])
        if "N" in attribute_value:
            return int(attribute_value["N"])
        return None

    def _render_mcp_config(self, mcp_map: dict[str, dict[str, object]]) -> str:
        """Render the mcp_config DynamoDB map to the MCP_CONFIG env var value.

        mcp_map is keyed by user email (plus a "default" fallback entry),
        each value a nested map of tool_name -> BOOL/N. Rendered as a JSON
        object so get_mcp_config() can look up per-user permissions.
        """
        by_user: dict[str, dict[str, bool | int]] = {}
        for user_key, user_av in mcp_map.items():
            user_map = user_av.get("M")
            if user_map is None:
                continue
            entries: dict[str, bool | int] = {}
            for tool_key, tool_av in user_map.items():
                rendered = self._attribute_value_to_native(tool_av)
                if rendered is not None:
                    entries[tool_key] = rendered
            by_user[user_key] = entries
        return json.dumps(by_user, sort_keys=True)

    def _poll_once(self, raise_on_error: bool) -> None:
        try:
            response = self._client.get_item(
                TableName=self._table_name,
                Key={"configId": {"S": self._config_id}},
            )
        except Exception:
            logger.warning(
                "Config poll failed, keeping last known good values",
                exc_info=True,
            )
            if raise_on_error:
                raise
            return

        item = response.get("Item")
        if item is None:
            logger.warning(
                "Config item configId=%s not found in table=%s, keeping last known good values",
                self._config_id,
                self._table_name,
            )
            return

        pii_map = item.get("pii_to_anonymize", {}).get("M", {})
        mcp_map = item.get("mcp_config", {}).get("M", {})
        input_validation_map = item.get("input_validation", {}).get("M", {})

        pii_enabled = sorted(
            key for key, av in pii_map.items() if av.get("BOOL") is True
        )
        # mcp_config is keyed by user email (nested maps) in the current
        # schema, but a flat map of tool_name -> BOOL/N is still accepted
        # for backward compatibility (applied the same way to every user).
        if any("M" in av for av in mcp_map.values()):
            mcp_rendered = self._render_mcp_config(mcp_map)
        else:
            mcp_entries = []
            for key in sorted(mcp_map):
                rendered = self._attribute_value_to_str(mcp_map[key])
                if rendered is not None:
                    mcp_entries.append(f"{key}={rendered}")
            mcp_rendered = ",".join(mcp_entries)
        input_validation_entries = []
        for key in sorted(input_validation_map):
            rendered = self._attribute_value_to_str(input_validation_map[key])
            if rendered is not None:
                input_validation_entries.append(f"{key}={rendered}")

        new_values = {
            PII_ENV_VAR: ",".join(pii_enabled),
            MCP_ENV_VAR: mcp_rendered,
            INPUT_VALIDATION_ENV_VAR: ",".join(input_validation_entries),
        }

        with self._lock:
            changed = {
                key: value
                for key, value in new_values.items()
                if self._last_known_good.get(key) != value
            }
            if changed:
                for key, value in changed.items():
                    os.environ[key] = value
                    logger.info("Config changed: %s -> %s", key, value)
                self._last_known_good = new_values
