import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, Copy, LoaderCircle, Search, X } from "lucide-react";
import { getEvent, getEvents, type EventSummary } from "../api";
import type { TimeRange } from "../App";
import { OUTCOMES, OutcomeBadge } from "./OutcomeBadge";
import { Segmented, highlightJson, stagger } from "./ui";

const PAGE_SIZE = 50;
const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const OUTCOME_OPTIONS = [{ value: "", label: "All" }, ...OUTCOMES.map((o) => ({ value: o.value as string, label: o.label }))];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const latency = (ms: number | null) => (ms === null ? "—" : `${ms.toLocaleString("en-US")} ms`);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  );
}

function EventDetail({ summary, onClose }: { summary: EventSummary; onClose: () => void }) {
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    setJson(null);
    setError(null);
    getEvent(summary.requestId).then(
      (e) => { if (!stale) setJson(JSON.stringify(e, null, 2)); },
      (e) => { if (!stale) setError(e.message); },
    );
    return () => { stale = true; };
  }, [summary.requestId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setClosing(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function copy() {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the JSON is still selectable */ }
  }

  return (
    <>
      <div className={closing ? "backdrop closing" : "backdrop"} onClick={() => setClosing(true)} />
      <aside
        className={closing ? "drawer closing" : "drawer"} role="dialog" aria-label="Event details"
        // unmount only after the slide-out animation has finished
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) onClose(); }}
      >
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <OutcomeBadge outcome={summary.outcome} pill />
            <div className="drawer-title">{summary.requestId}</div>
          </div>
          <button className="btn ghost icon" aria-label="Close" onClick={() => setClosing(true)}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="facts">
            <Fact label="Time">{formatTime(summary.timestamp)}</Fact>
            <Fact label="Caller">{summary.principalId ?? "—"}</Fact>
            <Fact label="Reason">{summary.reasonCode ?? "—"}</Fact>
            <Fact label="Category">{summary.category ?? "—"}</Fact>
            <Fact label="Severity">{summary.severity ?? "—"}</Fact>
            <Fact label="Latency">{latency(summary.latencyMs)}</Fact>
          </div>

          <div>
            <div className="section-title">
              Raw event
              <button className="btn small ghost" onClick={copy} disabled={!json}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {error && <p className="form-error" role="alert"><CircleAlert size={16} />{error}</p>}
            {!json && !error && <div className="skeleton" style={{ height: 320 }} />}
            {json && <pre className="json rise">{highlightJson(json)}</pre>}
          </div>
        </div>
      </aside>
    </>
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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EventSummary | null>(null);

  const query = { from: range.from, to: range.to, outcome, severity, principalId, limit: PAGE_SIZE };
  const filtered = Boolean(outcome || severity || principalId);

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
      .finally(() => { if (!stale) { setLoading(false); setLoaded(true); } });
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
      <form className="filterbar rise" onSubmit={(e) => { e.preventDefault(); setPrincipalId(principalInput.trim()); }}>
        <div className="field">
          Outcome
          <Segmented label="Outcome" options={OUTCOME_OPTIONS} value={outcome} onChange={setOutcome} />
        </div>
        <label className="field">
          Severity
          <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field grow">
          Caller
          <span className="input-icon">
            <Search size={15} />
            <input className="input" placeholder="user_12345, then Enter" value={principalInput}
              onChange={(e) => setPrincipalInput(e.target.value)} />
          </span>
        </label>
        {filtered && (
          <button type="button" className="btn ghost" onClick={() => {
            setOutcome(""); setSeverity(""); setPrincipalInput(""); setPrincipalId("");
          }}>
            <X size={15} />Clear filters
          </button>
        )}
      </form>

      {error && <p className="form-error" role="alert"><CircleAlert size={16} />Could not load events: {error}</p>}

      {!loaded ? <div className="skeleton" style={{ height: 520 }} /> : (
        <section className={`card table-card rise${loading ? " reloading" : ""}`} style={stagger(1)}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th><th>Request</th><th>Caller</th><th>Outcome</th>
                  <th>Reason</th><th>Severity</th><th className="num">Latency</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e, i) => (
                  <tr
                    key={e.requestId}
                    className={selected?.requestId === e.requestId ? "row selected" : "row"}
                    // only the first page staggers in; later pages just fade
                    style={stagger(i < PAGE_SIZE ? i : 0)}
                    tabIndex={0}
                    onClick={() => setSelected(e)}
                    onKeyDown={(k) => { if (k.key === "Enter") setSelected(e); }}
                  >
                    <td className="nowrap">{formatTime(e.timestamp)}</td>
                    <td className="mono nowrap">{e.requestId}</td>
                    <td className="nowrap">{e.principalId ?? "—"}</td>
                    <td><OutcomeBadge outcome={e.outcome} pill /></td>
                    <td>{e.reasonCode ?? <span className="muted">—</span>}</td>
                    <td>{e.severity ? <span className="tag">{e.severity}</span> : "—"}</td>
                    <td className="num">{latency(e.latencyMs)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="empty">No events match this period and these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="muted">{items.length.toLocaleString("en-US")} shown</span>
            {nextCursor && (
              <button className="btn" disabled={loading} onClick={loadMore}>
                {loading ? <LoaderCircle className="spinner" size={15} /> : <ChevronDown size={15} />}
                Load more
              </button>
            )}
          </div>
        </section>
      )}

      {selected && <EventDetail summary={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
