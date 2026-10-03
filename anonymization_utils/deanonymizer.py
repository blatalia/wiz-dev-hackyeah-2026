import csv
import re
from pathlib import Path

DEFAULT_DICT_PATH = Path(__file__).with_name("anonymization_dict.csv")


class Deanonymizer:
    """Replaces known IDs (from anonymization_dict.csv) found in a string with their PII value."""

    def __init__(self, dict_path: Path = DEFAULT_DICT_PATH) -> None:
        self.lookup = self._load_dict(dict_path)
        self.pattern = self._build_pattern(self.lookup)

    @staticmethod
    def _load_dict(dict_path: Path) -> dict[str, str]:
        lookup: dict[str, str] = {}
        with open(dict_path, "r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f, delimiter=";"):
                lookup[row["ID"].strip()] = row["PII"].strip()
        return lookup

    @staticmethod
    def _build_pattern(lookup: dict[str, str]) -> re.Pattern[str] | None:
        if not lookup:
            return None
        ids = sorted(lookup, key=len, reverse=True)
        return re.compile(r"\b(" + "|".join(re.escape(id_) for id_ in ids) + r")\b")

    def deanonymize(self, text: str) -> str:
        if self.pattern is None:
            return text
        return self.pattern.sub(lambda m: self.lookup[m.group(0)], text)


# if __name__ == "__main__":
#     text = "The merger involves C014 and C021, with W067 as the lead negotiator."
#     deanonymizer = Deanonymizer()
#     print(deanonymizer.deanonymize(text))
