import re
from pathlib import Path

PATTERNS_FILE = Path(__file__).resolve().parent / "sql_patterns.txt"

class DetectSQL:
    """Detect likely SQL injection attempts using patterns loaded from a file."""

    def __init__(self, patterns_file: Path = PATTERNS_FILE) -> None:
        self.patterns = self._load_patterns(patterns_file)

    @staticmethod
    def _load_patterns(patterns_file: Path) -> list[re.Pattern[str]]:
        """Read non-empty, non-comment lines from patterns_file and compile them as regexes."""
        lines = patterns_file.read_text(encoding="utf-8").splitlines()
        return [
            re.compile(line)
            for line in (line.strip() for line in lines)
            if line and not line.startswith("#")
        ]

    def find_sql_patterns(self, text: str) -> list[tuple[str, str]]:
        """Return (pattern, matched substring) pairs for each pattern that matches text."""
        return [
            (pattern.pattern, match.group())
            for pattern in self.patterns
            if (match := pattern.search(text))
        ]

    def is_sql(self, text: str) -> bool:
        """Return True if any configured SQL injection pattern matches text."""
        return any(pattern.search(text) for pattern in self.patterns)


if __name__ == "__main__":
    detector = DetectSQL()
    sample = "SELECT * FROM users WHERE id=1 OR 1=1 --"
    print(detector.is_sql(sample))