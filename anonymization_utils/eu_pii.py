import json
import os
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "pii_config.yml"
load_dotenv()
# Kept in sync with DynamoDB by gateway.guardrails.config_poller.ConfigPoller:
# a comma-separated list of the PII categories currently enabled (e.g.
# "ACCOUNT_NUMBER,EMAIL,IBAN"). Read directly from os.environ here (rather than
# importing the gateway package) so this module stays usable standalone.
PII_ENV_VAR = "PII_TO_ANONYMIZE"

LABEL_ALIASES = {
    "ORG": "COMPANY_NAME",
    "PER": "PERSON",
    "private_person": "PERSON",
    "private_email": "EMAIL",
    "LOC": "LOCATION",
    "MISC": "MISCALLANEOUS",
    "FIRSTNAME": "PERSON",
    "LASTNAME": "PERSON",
    "MIDDLENAME": "PERSON",
}


def normalize(label: str) -> str:
    label = label.split("-", 1)[-1] if "-" in label else label
    return LABEL_ALIASES.get(label, label)


def load_pii_to_anonymize(config_path: Path) -> set[str]:
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return set(config.get("pii_to_anonymize", []))


def enabled_pii_types(config_path: Path = DEFAULT_CONFIG_PATH) -> set[str]:
    """Return the PII categories currently enabled for anonymization.

    Prefers the live PII_TO_ANONYMIZE environment variable so toggling a
    category in the dashboard/DynamoDB takes effect on the next detection
    call, without reloading the (expensive) model. Falls back to the static
    pii_config.yml list when the env var is unset, e.g. running this module
    standalone outside the gateway where no poller is populating it.
    """
    raw = os.environ.get(PII_ENV_VAR)
    if raw is not None:
        return {item for item in raw.split(",") if item}
    return load_pii_to_anonymize(config_path)


def spans_overlap(a: dict, b: dict) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


def bridge_gaps(spans: list[dict], text: str) -> list[dict]:
    """Merge adjacent same-label spans when the gap between them has no whitespace,
    fixing mid-word splits caused by misclassified sub-word tokens."""
    if not spans:
        return spans
    spans = sorted(spans, key=lambda e: e["start"])
    merged = [dict(spans[0])]
    for e in spans[1:]:
        last = merged[-1]
        gap = text[last["end"]:e["start"]]
        if e["label"] == last["label"] and not any(ch.isspace() for ch in gap):
            last["end"] = e["end"]
            last["score"] = max(last["score"], e["score"])
        else:
            merged.append(dict(e))
    return merged


class PIIDetector:
    """Combines eu-pii-safeguard (general PII) with bert-base-NER (company recall)."""

    def __init__(
        self,
        pii_model_name: str = "tabularisai/eu-pii-safeguard",
        ner_model_name: str = "dslim/bert-base-NER",
        api_key: str | None = None,
        config_path: Path = DEFAULT_CONFIG_PATH,
    ) -> None:
        load_dotenv()
        self.ner_model_name = ner_model_name
        self.hf_token = os.environ["HF_TOKEN"]
        self.pii_api_key = api_key or os.getenv("API_KEY")
        self.client = InferenceClient(provider="hf-inference", api_key=self.pii_api_key)
        self.config_path = config_path

    def _run_pii_safeguard(self, text: str) -> list[dict]:
        """Call the private Hugging Face NER Space."""

        response = requests.post(
            "https://blatalia-hackyeah26.hf.space/predict",
            headers={
                "Authorization": f"Bearer {self.hf_token}",

                "X-PII-API-Key": self.pii_api_key,

                "Content-Type": "application/json",
            },
            json={"text": text},
            timeout=120,
        )

        response.raise_for_status()

        data = response.json()

        spans = [
            {
                "start": entity["start"],
                "end": entity["end"],
                "label": normalize(entity["label"]),
                "score": float(entity["score"]),
            }
            for entity in data["entities"]
        ]
        return bridge_gaps(spans, text)

    def _run_bert_ner(self, text: str) -> list[dict]:
        """Backfill for classes eu-pii-safeguard misses/doesn't cover: companies and names."""
        result = self.client.token_classification(text, model=self.ner_model_name)
        spans = [
            {"start": e.start, "end": e.end, "label": normalize(e.entity or e.entity_group), "score": e.score}
            for e in result
        ]
        spans = [s for s in spans if s["label"] in ("COMPANY_NAME", "PERSON")]
        return bridge_gaps(spans, text)

    def _merge(self, *entity_lists: list[dict]) -> list[dict]:
        merged = [e for entities in entity_lists for e in entities]
        merged.sort(key=lambda e: e["start"])

        result: list[dict] = []
        for e in merged:
            clash = next((r for r in result if spans_overlap(r, e)), None)
            if clash is None:
                result.append(e)
            elif e["score"] > clash["score"]:
                result.remove(clash)
                result.append(e)
        return sorted(result, key=lambda e: e["start"])

    def detect(self, text: str) -> list[dict]:
        """Detect PII spans whose category is currently enabled.

        Re-reads the enabled category set on every call (see
        enabled_pii_types) so a change pushed via DynamoDB/MCP_CONFIG-style
        polling takes effect immediately, without recreating this detector.
        """
        pii_spans = self._run_pii_safeguard(text)
        company_spans = self._run_bert_ner(text)
        merged = self._merge(pii_spans, company_spans)
        pii_to_anonymize = enabled_pii_types(self.config_path)
        return [
            {"label": e["label"], "text": text[e["start"]:e["end"]], "start": e["start"], "end": e["end"], "score": e["score"]}
            for e in merged
            if e["label"] in pii_to_anonymize
        ]

    def detect_json(self, text: str, **json_kwargs) -> str:
        return json.dumps(self.detect(text), **json_kwargs)


if __name__ == "__main__":
    text = "My name is Sarah Jessica Parker. I am conducting a merger of Rhein Industrial with BalticInc. I'll email john.pork@gmail.com and contact Eva Muller. My home address is 123 Main St, Anytown, USA. The bank account in question is PL50558984522137676769694200."
    detector = PIIDetector()
    print(detector.detect_json(text, indent=2))

