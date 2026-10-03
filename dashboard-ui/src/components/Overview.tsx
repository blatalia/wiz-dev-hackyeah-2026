import { useEffect, useState } from "react";
import { getStats, type DayCounts, type EventStats } from "../api";
import type { TimeRange } from "../App";
import { OutcomeChart } from "./OutcomeChart";
import { OutcomeBadge } from "./OutcomeBadge";

const DAY_MS = 24 * 60 * 60 * 1000;

// The API only returns days that have events; add the empty ones so the axis has no holes.
function fillDays(stats: EventStats): DayCounts[] {
  const known = new Map(stats.byDay.map((d) => [d.day, d]));
  const days: DayCounts[] = [];
  const last = stats.range.to.slice(0, 10);
  for (let t = Date.parse(stats.range.from.slice(0, 10)); ; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day > last) break;
    days.push(known.get(day) ?? { day, allowed: 0, flagged: 0, blocked: 0 });
  }
  return days;
}

function share(part: number, total: number) {
  return total ? `${((part / total) * 100).toFixed(1)}% of requests` : "—";
}

function ms(v: number | null) {
  return v === null ? "—" : `${v.toLocaleString("en-US")} ms`;
}

function StatTile({ label, value, note }: { label: React.ReactNode; value: string; note?: string }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note && <div className="tile-note muted">{note}</div>}
    </div>
  );
}

function BarList({ title, rows, empty }: {
  title: string;
  rows: { label: string; value: number; note?: string }[];
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section className="card">
      <div className="card-head"><h2>{title}</h2></div>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="barlist">
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`}>
              <span className="barlist-label">{r.label}</span>
              <span className="barlist-track">
                <span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
              </span>
              <span className="barlist-value">
                {r.value.toLocaleString("en-US")}
                {r.note && <span className="muted"> {r.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Overview({ range }: { range: TimeRange }) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    getStats(range.from, range.to)
      .then((s) => { if (!stale) { setStats(s); setError(null); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to]);

  if (error) return <p className="error" role="alert">Could not load statistics: {error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  const t = stats.totals;
  return (
    // while reloading, keep the previous numbers on screen instead of flashing a placeholder
    <div className={loading ? "stack reloading" : "stack"}>
      <div className="tiles">
        <StatTile label="Total requests" value={t.total.toLocaleString("en-US")} />
        <StatTile label={<OutcomeBadge outcome="ALLOWED" />} value={t.allowed.toLocaleString("en-US")} note={share(t.allowed, t.total)} />
        <StatTile label={<OutcomeBadge outcome="FLAGGED" />} value={t.flagged.toLocaleString("en-US")} note={share(t.flagged, t.total)} />
        <StatTile label={<OutcomeBadge outcome="BLOCKED" />} value={t.blocked.toLocaleString("en-US")} note={share(t.blocked, t.total)} />
        <StatTile label="Average latency" value={ms(t.avgLatencyMs)} />
        <StatTile label="95th percentile latency" value={ms(t.p95LatencyMs)} />
      </div>

      <OutcomeChart days={fillDays(stats)} />

      <div className="two-col">
        <BarList
          title="Top reasons for flagging or blocking"
          empty="No flagged or blocked requests in this period."
          rows={stats.topReasons.map((r) => ({ label: r.reasonCode, value: r.count }))}
        />
        <BarList
          title="Callers with the most blocked requests"
          empty="No requests in this period."
          rows={stats.topPrincipals.map((p) => ({
            label: p.principalId ?? "unknown",
            value: p.blocked,
            note: `of ${p.total.toLocaleString("en-US")}`,
          }))}
        />
      </div>
    </div>
  );
}
