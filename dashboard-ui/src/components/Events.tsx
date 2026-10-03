import { useEffect, useState } from "react";
import { getEvent, getEvents, type EventSummary } from "../api";
import type { TimeRange } from "../App";
import { OUTCOMES, OutcomeBadge } from "./OutcomeBadge";

const PAGE_SIZE = 50;
const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function EventDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [event, setEvent] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setEvent(null);
    setError(null);
    getEvent(requestId).then(
      (e) => { if (!stale) setEvent(e); },
      (e) => { if (!stale) setError(e.message); },
    );
    return () => { stale = true; };
  }, [requestId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="drawer" aria-label="Event details">
      <div className="card-head">
        <h2>{requestId}</h2>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!event && !error && <p className="muted">Loading…</p>}
      {event && <pre className="json">{JSON.stringify(event, null, 2)}</pre>}
    </aside>
  );
}

export function Events({ range }: { range: TimeRange }) {
  const [outcome, setOutcome] = useState("");
  const [severity, setSeverity] = useState("");
  const [principalInput, setPrincipalInput] = useState("");
  const [principalId, setPrincipalId] = useState("");

  const [items, setItems] = useState<EventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const query = { from: range.from, to: range.to, outcome, severity, principalId, limit: PAGE_SIZE };

  // First page: reload whenever the period or a filter changes
  useEffect(() => {
    let stale = false;
    setLoading(true);
    getEvents(query)
      .then((page) => {
        if (stale) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch((e) => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to, outcome, severity, principalId]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await getEvents({ ...query, cursor: nextCursor });
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <form className="filters inner" onSubmit={(e) => { e.preventDefault(); setPrincipalId(principalInput.trim()); }}>
        <label>
          <span className="muted">Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All</option>
            {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          <span className="muted">Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span className="muted">Caller</span>
          <input placeholder="user_12345" value={principalInput} onChange={(e) => setPrincipalInput(e.target.value)} />
        </label>
        <button className="btn">Apply</button>
        {(outcome || severity || principalId) && (
          <button type="button" className="btn" onClick={() => {
            setOutcome(""); setSeverity(""); setPrincipalInput(""); setPrincipalId("");
          }}>
            Clear filters
          </button>
        )}
      </form>

      {error && <p className="error" role="alert">Could not load events: {error}</p>}

      <section className={loading ? "card reloading" : "card"}>
        <div className="table-wrap">
          <table className="events">
            <thead>
              <tr>
                <th>Time</th><th>Request</th><th>Caller</th><th>Outcome</th>
                <th>Reason</th><th>Category</th><th>Severity</th><th className="num">Latency</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr
                  key={e.requestId}
                  className={selected === e.requestId ? "row selected" : "row"}
                  tabIndex={0}
                  onClick={() => setSelected(e.requestId)}
                  onKeyDown={(k) => { if (k.key === "Enter") setSelected(e.requestId); }}
                >
                  <td>{formatTime(e.timestamp)}</td>
                  <td className="mono">{e.requestId}</td>
                  <td>{e.principalId ?? "—"}</td>
                  <td><OutcomeBadge outcome={e.outcome} /></td>
                  <td>{e.reasonCode ?? "—"}</td>
                  <td>{e.category ?? "—"}</td>
                  <td>{e.severity ?? "—"}</td>
                  <td className="num">{e.latencyMs === null ? "—" : `${e.latencyMs.toLocaleString("en-US")} ms`}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="muted empty">No events match this period and these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span className="muted">{items.length.toLocaleString("en-US")} shown</span>
          {nextCursor && <button className="btn" disabled={loading} onClick={loadMore}>Load more</button>}
        </div>
      </section>

      {selected && <EventDetail requestId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
