import { Check, X } from "lucide-react";

export const OUTCOMES = [
  { key: "allowed", value: "ALLOWED", label: "Allowed", Icon: Check },
  { key: "blocked", value: "BLOCKED", label: "Blocked", Icon: X },
] as const;

export type OutcomeKey = (typeof OUTCOMES)[number]["key"];

export function OutcomeIcon({ outcome }: { outcome: OutcomeKey }) {
  const { Icon } = OUTCOMES.find((o) => o.key === outcome)!;
  return (
    <span className={`outcome-icon status-${outcome}`} aria-hidden="true">
      <Icon size={11} strokeWidth={3} />
    </span>
  );
}

export function OutcomeBadge({ outcome, pill = false }: { outcome: string; pill?: boolean }) {
  const known = OUTCOMES.find((o) => o.value === outcome);
  if (!known) return <span className="tag">{outcome}</span>;
  return (
    <span className={`outcome status-${known.key}${pill ? " pill" : ""}`}>
      <OutcomeIcon outcome={known.key} />
      {known.label}
    </span>
  );
}
