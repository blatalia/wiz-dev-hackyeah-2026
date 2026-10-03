import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, CloudOff, Hash, Inbox, LoaderCircle, RotateCw, Search, Tag, X } from "lucide-react";
import { getEvents, type EventSummary } from "../api";
import type { TimeRange } from "../App";
import type { Params } from "../route";
import { EventDetail } from "./EventDetail";
import { OUTCOMES, OutcomeBadge } from "./OutcomeBadge";
import { Segmented, State, stagger } from "./ui";

const PAGE_SIZE = 50;
const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const OUTCOME_OPTIONS = [{ value: "", label: "All" }, ...OUTCOMES.map((o) => ({ value: o.value as string, label: o.label }))];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatWindow(from: string, to: string) {
  const a = new Date(from), b = new Date(to);
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  // a whole UTC day (from the daily chart) reads better as just the date
  if (b.getTime() - a.getTime() === 24 * 60 * 60 * 1000 && from.slice(11, 19) === "00:00:00") {
    return a.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + " (UTC)";
  }
  return `${date(a)}, ${time(a)}–${time(b)}`;
}

const isDate = (v: string | undefined): v is string => Boolean(v) && !isNaN(Date.parse(v!));

export function Events({ range, params, setParams }: {
  range: TimeRange;
  params: Record<string, string>;
  setParams: (patch: Params) => void;
}) {
  // Filters live in the URL so they survive reload and the back button.
  const outcome = params.outcome ?? "";
  const severity = params.severity ?? "";
  const caller = params.caller ?? "";
  const reason = params.reason ?? "";
  // a time window picked on the overview chart narrows the global period
  const hasWindow = isDate(params.from) && isDate(params.to);
  const from = hasWindow ? params.from : range.from;
  const to = hasWindow ? params.to : range.to;

  const [callerInput, setCallerInput] = useState(caller);
  const [idInput, setIdInput] = useState("");
  const [items, setItems] = useState<EventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const loadedKey = useRef("");

  useEffect(() => setCallerInput(caller), [caller]);

  const query = { from, to, outcome, severity, principalId: caller, reasonCode: reason, limit: PAGE_SIZE };
  const filterKey = JSON.stringify([range.id, outcome, severity, caller, reason, params.from, params.to, attempt]);
  const filtered = Boolean(outcome || severity || caller || reason || hasWindow);

  useEffect(() => {
    let stale = false;
    // A live tick with unchanged filters only adds the rows that arrived since the last load,
    // so pages the reader has already loaded stay where they are.
    const liveTick = range.quiet && loadedKey.current === filterKey;
    if (!liveTick) setLoading(true);
    getEvents(query)
      .then((page) => {
        if (stale) return;
        if (liveTick) {
          const known = new Set(itemsRef.current.map((e) => e.requestId));
          const arrived = page.items.filter((e) => !known.has(e.requestId));
          if (arrived.length > 0) {
            setItems([...arrived, ...itemsRef.current]);
            setFresh(new Set(arrived.map((e) => e.requestId)));
          }
        } else {
          setItems(page.items);
          setNextCursor(page.nextCursor);
          setFresh(new Set());
        }
        loadedKey.current = filterKey;
        setError(null);
      })
      .catch((e) => { if (!stale && !liveTick) setError(e.message); })
      .finally(() => { if (!stale) { setLoading(false); setLoaded(true); } });
    return () => { stale = true; };
  }, [from, to, filterKey]);

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

  const clearAll = () => setParams({
    outcome: undefined, severity: undefined, caller: undefined, reason: undefined, from: undefined, to: undefined,
  });

  return (
    <div className="stack">
      <div className="filterbar rise">
        <div className="field">
          Outcome
          <Segmented label="Outcome" options={OUTCOME_OPTIONS} value={outcome}
            onChange={(v) => setParams({ outcome: v || undefined })} />
        </div>
        <label className="field">
          Severity
          <select className="input" value={severity} onChange={(e) => setParams({ severity: e.target.value || undefined })}>
            <option value="">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <form className="field grow" onSubmit={(e) => { e.preventDefault(); setParams({ caller: callerInput.trim() || undefined }); }}>
          <label htmlFor="caller-filter">Caller</label>
          <span className="input-icon">
            <Search size={15} />
            <input id="caller-filter" className="input" placeholder="user_12345, then Enter" value={callerInput}
              onChange={(e) => setCallerInput(e.target.value)} />
          </span>
        </form>
        <form className="field grow" onSubmit={(e) => {
          e.preventDefault();
          if (idInput.trim()) { setParams({ event: idInput.trim() }); setIdInput(""); }
        }}>
          <label htmlFor="id-search">Open by request ID</label>
          <span className="input-icon">
            <Hash size={15} />
            <input id="id-search" className="input mono" placeholder="req_…, then Enter" value={idInput}
              onChange={(e) => setIdInput(e.target.value)} />
          </span>
        </form>
      </div>

      {(hasWindow || reason || filtered) && (
        <div className="chips">
          {hasWindow && (
            <span className="chip">
              <CalendarClock size={14} />{formatWindow(from, to)}
              <button aria-label="Remove time filter" onClick={() => setParams({ from: undefined, to: undefined })}><X size={13} /></button>
            </span>
          )}
          {reason && (
            <span className="chip">
              <Tag size={14} />{reason}
              <button aria-label="Remove reason filter" onClick={() => setParams({ reason: undefined })}><X size={13} /></button>
            </span>
          )}
          {filtered && (
            <button className="btn small ghost" onClick={clearAll}><X size={14} />Clear all filters</button>
          )}
        </div>
      )}

      {error ? (
        <State Icon={CloudOff} tone="error" title="Events could not be loaded"
          action={<button className="btn" onClick={() => setAttempt(attempt + 1)}><RotateCw size={15} />Try again</button>}>
          {error}
        </State>
      ) : !loaded ? <div className="skeleton" style={{ height: 520 }} /> : items.length === 0 ? (
        <State Icon={Inbox} title="No events here"
          action={filtered && <button className="btn" onClick={clearAll}>Clear all filters</button>}>
          {filtered
            ? "Nothing matches these filters in the selected period."
            : "The gateway has not recorded any requests in the selected period."}
        </State>
      ) : (
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
                    className={`row${params.event === e.requestId ? " selected" : ""}${fresh.has(e.requestId) ? " fresh" : ""}`}
                    // only the first page staggers in; later pages just fade
                    style={stagger(i < PAGE_SIZE ? i : 0)}
                    tabIndex={0}
                    onClick={() => setParams({ event: e.requestId })}
                    onKeyDown={(k) => { if (k.key === "Enter") setParams({ event: e.requestId }); }}
                  >
                    <td className="nowrap">{formatTime(e.timestamp)}</td>
                    <td className="mono nowrap">{e.requestId}</td>
                    <td className="nowrap">{e.principalId ?? "—"}</td>
                    <td><OutcomeBadge outcome={e.outcome} pill /></td>
                    <td>{e.reasonCode ?? <span className="muted">—</span>}</td>
                    <td>{e.severity ? <span className="tag">{e.severity}</span> : "—"}</td>
                    <td className="num">{e.latencyMs === null ? "—" : `${e.latencyMs.toLocaleString("en-US")} ms`}</td>
                  </tr>
                ))}
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

      {params.event && <EventDetail requestId={params.event} onClose={() => setParams({ event: undefined })} />}
    </div>
  );
}
