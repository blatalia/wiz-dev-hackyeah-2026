import json
import os

import torch
from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from transformers import AutoModelForTokenClassification, AutoTokenizer

LABEL_ALIASES = {
    "ORG": "COMPANY_NAME",
    "PER": "PERSON",
    "private_person": "PERSON",
    "private_email": "EMAIL",
}


def normalize(label: str) -> str:
    label = label.split("-", 1)[-1] if "-" in label else label
    return LABEL_ALIASES.get(label, label)


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
        if e["label"] == last["label"] and gap.strip() == "":
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
    ) -> None:
        load_dotenv()
        self.ner_model_name = ner_model_name
        self.tokenizer = AutoTokenizer.from_pretrained(pii_model_name)
        self.model = AutoModelForTokenClassification.from_pretrained(pii_model_name)
        self.client = InferenceClient(provider="hf-inference", api_key=api_key or os.getenv("API_KEY"))

    def _run_pii_safeguard(self, text: str) -> list[dict]:
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True, return_offsets_mapping=True)
        offsets = inputs.pop("offset_mapping")[0].tolist()
        with torch.no_grad():
            logits = self.model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)
            predictions = torch.argmax(probs, dim=-1)

        spans = []
        current_label = None
        span_start = span_end = None
        span_score = 0.0
        for (start, end), pred, prob in zip(offsets, predictions[0].tolist(), probs[0]):
            if start == end:  # special tokens ([CLS]/[SEP]/padding) have empty offsets
                continue
            label = self.model.config.id2label[pred]
            entity = label.split("-", 1)[1] if "-" in label else None

            if entity != current_label:
                if current_label is not None:
                    spans.append({"start": span_start, "end": span_end, "label": normalize(current_label), "score": span_score})
                current_label = entity
                span_start = start
                span_score = 0.0
            span_end = end
            span_score = max(span_score, prob[pred].item())

        if current_label is not None:
            spans.append({"start": span_start, "end": span_end, "label": normalize(current_label), "score": span_score})
        return bridge_gaps(spans, text)

    def _run_bert_ner(self, text: str) -> list[dict]:
        """Used only for its stronger COMPANY_NAME/ORG recall."""
        result = self.client.token_classification(text, model=self.ner_model_name)
        spans = [
            {"start": e.start, "end": e.end, "label": normalize(e.entity or e.entity_group), "score": e.score}
            for e in result
        ]
        spans = [s for s in spans if s["label"] == "COMPANY_NAME"]
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
        pii_spans = self._run_pii_safeguard(text)
        company_spans = self._run_bert_ner(text)
        merged = self._merge(pii_spans, company_spans)
        return [
            {"label": e["label"], "text": text[e["start"]:e["end"]], "start": e["start"], "end": e["end"], "score": e["score"]}
            for e in merged
        ]

    def detect_json(self, text: str, **json_kwargs) -> str:
        return json.dumps(self.detect(text), **json_kwargs)


# if __name__ == "__main__":
#     text = "My name is Sarah Jessica Parker. I am conducting a merger of RolloCorp with BalticInc. Ill email john.pork@gmail.com"
#     detector = PIIDetector()
#     print(detector.detect_json(text, indent=2))

