"""Background poller that mirrors the ai-gateway-config DynamoDB table into
environment variables, so guardrail functions always see live config without
needing a restart or an explicit DynamoDB call on every request.

Usage:
    from gateway.guardrails.config_poller import ConfigPoller

    poller = ConfigPoller()
    poller.start()  # does a synchronous initial load, then polls in background
    ...
    os.environ["GATEWAY_CHECK_EMAIL"]  # "true" / "false", kept up to date
    ...
    poller.stop()
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Final

import boto3

logger = logging.getLogger(__name__)

# Prefix applied to every config flag when mirrored into the environment,
# e.g. config flag "email" -> env var "GATEWAY_CHECK_EMAIL".
ENV_VAR_PREFIX: Final[str] = "GATEWAY_CHECK_"

DEFAULT_TABLE_NAME: Final[str] = "ai-gateway-config"
DEFAULT_CONFIG_ID: Final[str] = "default"
DEFAULT_REGION: Final[str] = "eu-north-1"
DEFAULT_POLL_INTERVAL_SECONDS: Final[float] = 60.0


def _flag_to_env_var(flag_name: str) -> str:
    return f"{ENV_VAR_PREFIX}{flag_name.upper()}"


def get_check_enabled(flag_name: str, default: bool = True) -> bool:
    """Read a single guardrail flag's current value from the environment.

    Call this at the point of use (not once at import time) so that
    functions always observe the latest value the poller has written.
    """
    raw = os.environ.get(_flag_to_env_var(flag_name))
    if raw is None:
        return default
    return raw == "true"


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
        self._last_known_good: dict[str, bool] = {}

    def start(self) -> None:
        """Load config synchronously once, then start background polling."""
        self._poll_once(raise_on_error=True)
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

        new_values: dict[str, bool] = {
            key: av["BOOL"]
            for key, av in item.items()
            if key != "configId" and "BOOL" in av
        }

        with self._lock:
            changed = {
                key: value
                for key, value in new_values.items()
                if self._last_known_good.get(key) != value
            }
            if changed:
                for key, value in changed.items():
                    os.environ[_flag_to_env_var(key)] = "true" if value else "false"
                    logger.info("Config flag changed: %s -> %s", key, value)
                self._last_known_good = new_values
