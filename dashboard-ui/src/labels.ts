const ACRONYMS = new Set([
  "ai", "api", "cvv", "dob", "eu", "hr", "iban", "id", "ip", "kyc", "llm", "mcp", "pii", "pin",
  "sql", "ssn", "uk", "url", "us", "vat",
]);

const OPENERS: Record<string, string> = { num: "number of", max: "maximum", min: "minimum" };

export function humanize(key: string): string {
  let words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.\-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  if (words.length === 0) return key;

  if (words[0] === "get" && words.length > 1) words = words.slice(1);
  if (OPENERS[words[0]] && words.length > 1) words = [...OPENERS[words[0]].split(" "), ...words.slice(1)];

  const text = words
    .map((w) => (ACRONYMS.has(w) || (/\d/.test(w) && /[a-z]/.test(w)) ? w.toUpperCase() : w))
    .join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describeValue(key: string, value: unknown): { label: string; text: string } {
  if (typeof value === "boolean") return { label: humanize(key), text: value ? "Yes" : "No" };
  if (value === null || value === undefined || value === "") return { label: humanize(key), text: "—" };
  if (typeof value !== "number") return { label: humanize(key), text: String(value) };

  const unit = /_(seconds|secs|milliseconds|ms)$/i.exec(key)?.[1].toLowerCase();
  if (unit) {
    const label = humanize(key.slice(0, -(unit.length + 1)));
    return unit === "ms" || unit === "milliseconds"
      ? { label, text: `${Math.round(value).toLocaleString("en-US")} ms` }
      : { label, text: `${value.toFixed(2)} s` };
  }
  if (/cost|price|spend/i.test(key)) return { label: humanize(key), text: `$${value.toFixed(4)}` };
  return {
    label: humanize(key),
    text: value.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }),
  };
}
