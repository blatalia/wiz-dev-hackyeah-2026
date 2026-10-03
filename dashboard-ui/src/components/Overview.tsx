import { useEffect, useState, type ReactNode } from "react";
import { Activity, CircleAlert } from "lucide-react";
import { getStats, type DayCounts, type EventStats } from "../api";
import type { TimeRange } from "../App";
import { OutcomeChart } from "./OutcomeChart";
import { OUTCOMES, OutcomeIcon } from "./OutcomeBadge";
import { Num, Sparkline, stagger } from "./ui";

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

const pct = (part: number, total: number) => (total ? (part / total) * 100 : 0);

function Kpi({ i, status, label, value, note, trend }: {
  i: number; status: string; label: ReactNode; value: number; note: string; trend: number[];
}) {
  return (
    <div className={`card kpi rise status-${status}`} style={stagger(i)}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value"><Num value={value} /></div>
      <div className="kpi-note">{note}</div>
      <Sparkline values={trend} />
    </div>
  );
}

function BarList({ i, title, sub, rows, empty }: {
  i: number;
  title: string;
  sub: string;
  rows: { label: string; value: number; note?: string }[];
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section className="card rise" style={stagger(i)}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          <p className="card-sub">{sub}</p>
        </div>
      </div>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="barlist">
          {rows.map((r, ri) => (
            <li key={r.label}>
              <span className="barlist-label">{r.label}</span>
              <span className="barlist-value">
                {r.value.toLocaleString("en-US")}
                {r.note && <span className="muted"> {r.note}</span>}
              </span>
              <span className="barlist-track">
                <span className="barlist-bar" style={{ ...stagger(ri), width: `${(r.value / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading statistics">
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 168 }} />)}
      </div>
      <div className="skeleton" style={{ height: 420 }} />
    </div>
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

  if (error) {
    return <p className="form-error" role="alert"><CircleAlert size={16} />Could not load statistics: {error}</p>;
  }
  if (!stats) return <Loading />;

  const t = stats.totals;
  const days = fillDays(stats);
  const share = (n: number) => (t.total ? `${pct(n, t.total).toFixed(1)}% of requests` : "No requests");

  return (
    // while reloading, keep the previous numbers on screen instead of flashing a placeholder
    <div className={loading ? "stack reloading" : "stack"}>
      <div className="kpis">
        <Kpi i={0} status="total" label={<><Activity size={16} />Total requests</>} value={t.total}
          note={`${days.length} ${days.length === 1 ? "day" : "days"} in range`}
          trend={days.map((d) => d.allowed + d.flagged + d.blocked)} />
        {OUTCOMES.map((o, i) => (
          <Kpi key={o.key} i={i + 1} status={o.key}
            label={<><OutcomeIcon outcome={o.key} />{o.label}</>}
            value={t[o.key]} note={share(t[o.key])} trend={days.map((d) => d[o.key])} />
        ))}
      </div>

      <div className="main-grid">
        <div className="rise" style={stagger(4)}>
          <OutcomeChart days={days} />
        </div>

        <section className="card rise" style={stagger(5)}>
          <div className="card-head">
            <div>
              <h2>Traffic mix</h2>
              <p className="card-sub">Share of each decision</p>
            </div>
          </div>
          <div className="mix-bar" role="img"
            aria-label={OUTCOMES.map((o) => `${o.label} ${pct(t[o.key], t.total).toFixed(1)}%`).join(", ")}>
            {OUTCOMES.filter((o) => t[o.key] > 0).map((o) => (
              <span key={o.key} className={`status-${o.key}`} style={{ flexGrow: t[o.key] }} />
            ))}
          </div>
          <ul className="mix-rows">
            {OUTCOMES.map((o) => (
              <li key={o.key}>
                <OutcomeIcon outcome={o.key} />
                {o.label}
                <span className="count">{t[o.key].toLocaleString("en-US")}</span>
                <span className="pct">{pct(t[o.key], t.total).toFixed(1)}%</span>
              </li>
            ))}
          </ul>

          <div className="divider" />

          <div className="card-head">
            <div>
              <h2>Latency</h2>
              <p className="card-sub">End to end, per request</p>
            </div>
          </div>
          <div className="latency">
            <div>
              <div className="fact-label">Average</div>
              <div className="latency-value">
                {t.avgLatencyMs === null ? "—" : <><Num value={t.avgLatencyMs} /><small>ms</small></>}
              </div>
            </div>
            <div>
              <div className="fact-label">95th percentile</div>
              <div className="latency-value">
                {t.p95LatencyMs === null ? "—" : <><Num value={t.p95LatencyMs} /><small>ms</small></>}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="two-col">
        <BarList i={6}
          title="Top reasons"
          sub="Why requests were flagged or blocked"
          empty="No flagged or blocked requests in this period."
          rows={stats.topReasons.map((r) => ({ label: r.reasonCode, value: r.count }))}
        />
        <BarList i={7}
          title="Callers with the most blocked requests"
          sub="Blocked requests out of all the caller sent"
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
