// Outcome is a status, so it is never shown by color alone: icon + label, text in normal ink.
export const OUTCOMES = [
  { key: "allowed", value: "ALLOWED", label: "Allowed", icon: "✓" },
  { key: "flagged", value: "FLAGGED", label: "Flagged", icon: "!" },
  { key: "blocked", value: "BLOCKED", label: "Blocked", icon: "✕" },
] as const;

export type OutcomeKey = (typeof OUTCOMES)[number]["key"];

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const known = OUTCOMES.find((o) => o.value === outcome);
  if (!known) return <span>{outcome}</span>;
  return (
    <span className="outcome">
      <span className={`outcome-icon status-${known.key}`} aria-hidden="true">{known.icon}</span>
      {known.label}
    </span>
  );
}
