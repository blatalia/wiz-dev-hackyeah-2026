import csv
from pathlib import Path

# from eu_pii import PIIDetector

DEFAULT_DICT_PATH = Path(__file__).with_name("anonymization_dict.csv")


class Anonymizer:
    """Replaces detected PII spans with a known ID (from anonymization_dict.csv) when the
    PII text and class match a dictionary entry, or with a [CLASS_NAME] placeholder otherwise."""

    def __init__(self, dict_path: Path = DEFAULT_DICT_PATH) -> None:
        self.lookup = self._load_dict(dict_path)

    @staticmethod
    def _load_dict(dict_path: Path) -> dict[tuple[str, str], str]:
        lookup: dict[tuple[str, str], str] = {}
        with open(dict_path, "r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                key = (row["PII_CLASS"].strip().casefold(), row["PII"].strip().casefold())
                lookup[key] = row["ID"].strip()
        return lookup

    def anonymize(self, text: str, detections: list[dict]) -> str:
        detections = sorted(detections, key=lambda e: e["start"])

        pieces = []
        cursor = 0
        for e in detections:
            key = (e["label"].strip().casefold(), e["text"].strip().casefold())
            replacement = self.lookup.get(key, f"[{e['label']}]")

            pieces.append(text[cursor:e["start"]])
            pieces.append(replacement)
            cursor = e["end"]
        pieces.append(text[cursor:])
        return "".join(pieces)


# if __name__ == "__main__":
#     text = "My name is Sarah Jessica Parker. I am conducting a merger of Rhein Industrial with BalticInc. I'll email john.pork@gmail.com and contact Eva Muller. My home address is 123 Main St, Anytown, USA. The bank account in question is PL50558984522137676769694200."
#     detections = PIIDetector().detect(text)

#     anonymizer = Anonymizer()
#     print(anonymizer.anonymize(text, detections))
