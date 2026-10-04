import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, SearchX, X } from "lucide-react";
import { ApiError, getEvent } from "../api";
import { describeValue, humanize } from "../labels";
import { href } from "../route";
import { OutcomeBadge } from "./OutcomeBadge";
import { State, highlightJson } from "./ui";

type GatewayEvent = Record<string, any>;

const STAGES = [
  { key: "classificationLatencyMs", label: "Classification", series: 1 },
  { key: "securityScanLatencyMs", label: "Security scan", series: 2 },
  { key: "llmLatencyMs", label: "LLM", series: 3 },
] as const;

const ms = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("en-US")} ms` : null);
const has = (v: unknown) => v !== null && v !== undefined && v !== "";
const isObject = (v: unknown): v is GatewayEvent => typeof v === "object" && v !== null && !Array.isArray(v);

function formatTime(iso: unknown) {
  if (typeof iso !== "string" || isNaN(Date.parse(iso))) return null;
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="detail-section">
      <div className="section-title">{title}{aside}</div>
      {children}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <button className="btn small ghost" onClick={copy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function Body({ event }: { event: GatewayEvent }) {
  const caller = isObject(event.caller) ? event.caller : {};
  const request = isObject(event.request) ? event.request : {};
  const decision = isObject(event.decision) ? event.decision : {};
  const classification = isObject(event.classification) ? event.classification : null;
  const securityScan = isObject(event.securityScan) ? event.securityScan : null;
  const llm = isObject(event.llm) ? event.llm : null;
  const performance = isObject(event.performance) ? event.performance : {};
  const inner = isObject(event.event) ? event.event : {};

  const reason = decision.reasonCode ?? inner.reason;
  const type = event.eventType ?? inner.event_type;
  const route = [request.method, request.route].filter(Boolean).join(" ");

  const facts: [string, ReactNode][] = ([
    ["Time", formatTime(event.timestamp)],
    ["Type", has(type) ? humanize(String(type)) : null],
    ["Latency", ms(performance.totalLatencyMs)],
    ["Cost", typeof inner.cost === "number" ? describeValue("cost", inner.cost).text : null],
    ["Passed safety check", typeof inner.is_safe === "boolean" ? (inner.is_safe ? "Yes" : "No") : null],
    ["Caller", has(caller.principalId)
      ? <a className="link" href={href("events", { caller: caller.principalId })}>{caller.principalId}</a> : null],
    ["Client", has(caller.clientId) ? String(caller.clientId) : null],
    ["Route", route || null],
    ["HTTP status", has(decision.httpStatus) ? String(decision.httpStatus) : null],
  ] as [string, ReactNode][]).filter(([, value]) => value !== null);

  const stages = STAGES
    .map((s) => ({ ...s, value: performance[s.key] }))
    .filter((s) => typeof s.value === "number" && s.value > 0);
  const labels: GatewayEvent[] = Array.isArray(classification?.labels) ? classification.labels : [];
  const findings: GatewayEvent[] = Array.isArray(securityScan?.findings) ? securityScan.findings : [];
  const fields = Object.entries(inner).filter(([k, v]) => k !== "reason" && !isObject(v) && !Array.isArray(v));
  const json = JSON.stringify(event, null, 2);

  return (
    <div className="drawer-body rise">
      <div className="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <div className="fact-label">{label}</div>
            <div className="fact-value">{value}</div>
          </div>
        ))}
      </div>

      {has(reason) && (
        <Section title="Reason">
          <p className="reason-box">{String(reason)}</p>
        </Section>
      )}

      {stages.length > 0 && (
        <Section title="Latency by stage">
          <div className="mix-bar" role="img" aria-label={stages.map((s) => `${s.label} ${s.value} ms`).join(", ")}>
            {stages.map((s) => <span key={s.key} className={`series-${s.series}`} style={{ flexGrow: s.value }} />)}
          </div>
          <ul className="mix-rows">
            {stages.map((s) => (
              <li key={s.key} className={`series-${s.series}`}>
                <span className="swatch" />{s.label}
                <span className="count">{ms(s.value)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {classification && (labels.length > 0 || has(classification.primaryCategory)) && (
        <Section title="Classification"
          aside={has(classification.primaryCategory) && <span className="tag">{classification.primaryCategory}</span>}>
          <ul className="scores">
            {labels.map((l, i) => (
              <li key={i}>
                <span>{String(l.name ?? "—")}</span>
                <span className="score-track">
                  <span className="score-bar" style={{ width: `${Math.min(Math.max(Number(l.score) || 0, 0), 1) * 100}%` }} />
                </span>
                <span className="count">{typeof l.score === "number" ? l.score.toFixed(2) : "—"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {securityScan && (
        <Section title="Security scan"
          aside={has(securityScan.highestSeverity) && <span className="tag">{securityScan.highestSeverity}</span>}>
          {findings.length === 0
            ? <p className="muted">{securityScan.performed === false ? "The scan was not run." : "No findings."}</p>
            : (
              <ul className="findings">
                {findings.map((f, i) => (
                  <li key={i}>
                    <div>
                      <div className="fact-value">{String(f.category ?? "—")}</div>
                      <div className="fact-label mono">{[f.ruleId, f.scanner].filter(Boolean).join(" · ")}</div>
                    </div>
                    {has(f.severity) && <span className="tag">{f.severity}</span>}
                  </li>
                ))}
              </ul>
            )}
        </Section>
      )}

      {llm && (
        <Section title="LLM call">
          {llm.called === false ? <p className="muted">The request was stopped before reaching the model.</p> : (
            <dl className="kv">
              {Object.entries(llm).filter(([, v]) => !isObject(v) && !Array.isArray(v)).map(([k, v]) => {
                const d = describeValue(k, v);
                return [<dt key={`${k}-label`}>{d.label}</dt>, <dd key={k}>{d.text}</dd>];
              })}
            </dl>
          )}
        </Section>
      )}

      {fields.length > 0 && (
        <Section title="Event fields">
          <dl className="kv">
            {fields.map(([k, v]) => {
              const d = describeValue(k, v);
              const text = /timestamp|_at$/i.test(k) ? formatTime(v) ?? d.text : d.text;
              return [<dt key={`${k}-label`}>{d.label}</dt>, <dd key={k}>{text}</dd>];
            })}
          </dl>
        </Section>
      )}

      <details className="raw">
        <summary>Raw event</summary>
        <div className="raw-actions"><CopyButton value={json} label="Copy JSON" /></div>
        <pre className="json">{highlightJson(json)}</pre>
      </details>
    </div>
  );
}

export function EventDetail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [event, setEvent] = useState<GatewayEvent | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let stale = false;
    setEvent(null);
    setError(null);
    getEvent(requestId).then(
      (e) => { if (!stale) setEvent(e); },
      (e) => { if (!stale) setError({ notFound: e instanceof ApiError && e.status === 404, message: e.message }); },
    );
    return () => { stale = true; };
  }, [requestId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setClosing(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className={closing ? "backdrop closing" : "backdrop"} onClick={() => setClosing(true)} />
      <aside
        className={closing ? "drawer closing" : "drawer"} role="dialog" aria-label="Event details"
        onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) onClose(); }}
      >
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {event?.decision?.outcome && <OutcomeBadge outcome={event.decision.outcome} pill />}
            <div className="drawer-title">{requestId}</div>
          </div>
          <CopyButton value={requestId} label="Copy ID" />
          <button className="btn ghost icon" aria-label="Close" onClick={() => setClosing(true)}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="drawer-body">
            <State Icon={SearchX} tone={error.notFound ? "neutral" : "error"}
              title={error.notFound ? "No event with this ID" : "The event could not be loaded"}>
              {error.notFound ? "Check the request ID, or it may have expired from storage." : error.message}
            </State>
          </div>
        )}
        {!event && !error && (
          <div className="drawer-body"><div className="skeleton" style={{ height: 420 }} /></div>
        )}
        {event && <Body event={event} />}
      </aside>
    </>
  );
}
