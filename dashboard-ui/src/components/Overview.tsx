import { useEffect, useState, type ReactNode } from "react";
import { Activity, CircleDollarSign, CloudOff, Gauge, RotateCw, Timer } from "lucide-react";
import { getStats, type BucketCounts, type EventStats, type StatsBucket } from "../api";
import type { TimeRange } from "../App";
import { humanize } from "../labels";
import { href, type Params } from "../route";
import { OutcomeChart } from "./OutcomeChart";
import { OUTCOMES, OutcomeIcon } from "./OutcomeBadge";
import { Delta, Num, Sparkline, State, stagger } from "./ui";

const STEP_MS: Record<StatsBucket, number> = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };

const bucketStart = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";

function fillBuckets(stats: EventStats): BucketCounts[] {
  const step = STEP_MS[stats.bucket];
  const known = new Map(stats.series.map((b) => [b.start, b]));
  const out: BucketCounts[] = [];
  const end = Date.parse(stats.range.to);
  for (let t = Math.floor(Date.parse(stats.range.from) / step) * step; t < end; t += step) {
    const start = bucketStart(t);
    out.push(known.get(start) ?? { start, allowed: 0, blocked: 0 });
  }
  return out;
}

const pct = (part: number, total: number) => (total ? (part / total) * 100 : 0);

function Kpi({ i, status, label, value, previous, period, trend, to, prefix, suffix, digits }: {
  i: number; status: string; label: ReactNode; value: number; previous: number; period: string;
  trend: number[]; to?: string; prefix?: string; suffix?: string; digits?: number;
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        <Num value={value} prefix={prefix} digits={digits} />
        {suffix && <small>{suffix}</small>}
      </div>
      <div className="kpi-note"><Delta current={value} previous={previous} period={period} /></div>
      <Sparkline values={trend} />
    </>
  );
  const className = `card kpi rise status-${status}`;
  return to
    ? <a className={className} style={stagger(i)} href={to}>{body}</a>
    : <div className={className} style={stagger(i)}>{body}</div>;
}

function BarList({ i, title, sub, rows }: {
  i: number;
  title: string;
  sub: string;
  rows: { label: string; value: number; note?: string; to: string }[];
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
      <ul className="barlist">
        {rows.map((r, ri) => (
          <li key={r.label}>
            <a href={r.to} title={`Show events: ${r.label}`}>
              <span className="barlist-label">{r.label}</span>
              <span className="barlist-value">
                {r.value.toLocaleString("en-US")}
                {r.note && <span className="muted"> {r.note}</span>}
              </span>
              <span className="barlist-track">
                <span className="barlist-bar" style={{ ...stagger(ri), width: `${(r.value / max) * 100}%` }} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading statistics">
      <div className="kpis">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 168 }} />)}
      </div>
      <div className="skeleton" style={{ height: 420 }} />
    </div>
  );
}

export function Overview({ range, rangeParam }: { range: TimeRange; rangeParam: string | undefined }) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [previous, setPrevious] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    const span = Date.parse(range.to) - Date.parse(range.from);
    const previousFrom = new Date(Date.parse(range.from) - span).toISOString();
    Promise.all([
      getStats(range.from, range.to, range.id === "24h" ? "hour" : "day"),
      getStats(previousFrom, range.from),
    ])
      .then(([now, before]) => { if (!stale) { setStats(now); setPrevious(before); setError(null); } })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to, range.id, attempt]);

  if (error && !stats) {
    return (
      <State Icon={CloudOff} tone="error" title="Statistics could not be loaded"
        action={<button className="btn" onClick={() => setAttempt(attempt + 1)}><RotateCw size={15} />Try again</button>}>
        {error}
      </State>
    );
  }
  if (!stats || !previous) return <Loading />;

  const t = stats.totals;
  const p = previous.totals;
  const buckets = fillBuckets(stats);
  const period = `previous ${range.label}`;
  const events = (params: Params) => href("events", { range: rangeParam, ...params });
  const lists = [
    stats.topReasons.length > 0 && (
      <BarList key="reasons" i={7} title="Top reasons" sub="The three most common reasons requests were blocked"
        rows={stats.topReasons.map((r) => ({ label: r.reasonCode, value: r.count, to: events({ reason: r.reasonCode }) }))} />
    ),
    stats.topPrincipals.some((c) => c.principalId) && (
      <BarList key="callers" i={8} title="Callers with the most blocked requests" sub="Blocked requests out of all the caller sent"
        rows={stats.topPrincipals.filter((c) => c.principalId).map((c) => ({
          label: c.principalId, value: c.blocked, note: `of ${c.total.toLocaleString("en-US")}`,
          to: events({ caller: c.principalId, outcome: "BLOCKED" }),
        }))} />
    ),
  ].filter(Boolean);

  return (
    <div className={loading && !range.quiet ? "stack reloading" : "stack"}>
      <div className="kpis">
        <Kpi i={0} status="total" label={<><Activity size={16} />Total requests</>}
          value={t.total} previous={p.total} period={period}
          trend={buckets.map((b) => b.allowed + b.blocked)} to={events({})} />
        {OUTCOMES.map((o, i) => (
          <Kpi key={o.key} i={i + 1} status={o.key}
            label={<><OutcomeIcon outcome={o.key} />{o.label}</>}
            value={t[o.key]} previous={p[o.key]} period={period}
            trend={buckets.map((b) => b[o.key])} to={events({ outcome: o.value })} />
        ))}
        {t.totalCost !== null && (
          <Kpi i={OUTCOMES.length + 1} status="total" label={<><CircleDollarSign size={16} />LLM cost</>}
            value={t.totalCost} previous={p.totalCost ?? 0} period={period} prefix="$" digits={4}
            trend={[]} to={events({ type: "llm_call" })} />
        )}
        {t.avgLatencyMs !== null && (
          <Kpi i={OUTCOMES.length + 2} status="total" label={<><Timer size={16} />Average latency</>}
            value={t.avgLatencyMs} previous={p.avgLatencyMs ?? 0} period={period} suffix="ms" trend={[]} />
        )}
        {t.p95LatencyMs !== null && (
          <Kpi i={OUTCOMES.length + 3} status="total" label={<><Gauge size={16} />95th percentile latency</>}
            value={t.p95LatencyMs} previous={p.p95LatencyMs ?? 0} period={period} suffix="ms" trend={[]} />
        )}
      </div>

      <div className="main-grid">
        <div className="rise" style={stagger(4)}>
          <OutcomeChart key={stats.bucket} buckets={buckets} unit={stats.bucket}
            onSelect={(b) => {
              window.location.hash = events({
                from: b.start,
                to: bucketStart(Date.parse(b.start) + STEP_MS[stats.bucket]),
              });
            }} />
        </div>

        <div className="side-col">
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
          </section>

          {stats.byType.length > 0 && (
            <BarList i={6} title="Requests by type" sub="What the gateway inspected in this period"
              rows={stats.byType.map((b) => ({
                label: humanize(b.eventType), value: b.total,
                note: `· ${b.blocked.toLocaleString("en-US")} blocked`, to: events({ type: b.eventType }),
              }))} />
          )}
        </div>
      </div>

      {lists.length > 0 && <div className={lists.length > 1 ? "two-col" : undefined}>{lists}</div>}
    </div>
  );
}
