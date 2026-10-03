import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, SearchX, X } from "lucide-react";
import { ApiError, getEvent } from "../api";
import { href } from "../route";
import { OutcomeBadge } from "./OutcomeBadge";
import { State, highlightJson } from "./ui";

type GatewayEvent = Record<string, any>;

const STAGES = [
  { key: "classificationLatencyMs", label: "Classification", series: 1 },
  { key: "securityScanLatencyMs", label: "Security scan", series: 2 },
  { key: "llmLatencyMs", label: "LLM", series: 3 },
] as const;

const ms = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("en-US")} ms` : "—");
const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

function formatTime(iso: unknown) {
  if (typeof iso !== "string" || isNaN(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  );
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
    } catch { /* clipboard unavailable: the text is still selectable */ }
  }
  return (
    <button className="btn small ghost" onClick={copy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// Where the time went: one bar split into the stages the gateway reports.
function LatencyBreakdown({ performance }: { performance: GatewayEvent }) {
  const stages = STAGES
    .map((s) => ({ ...s, value: performance[s.key] }))
    .filter((s): s is typeof s & { value: number } => typeof s.value === "number" && s.value > 0);
  if (stages.length === 0) return <p className="muted">No per-stage timings were recorded.</p>;
  return (
    <>
      <div className="mix-bar" role="img"
        aria-label={stages.map((s) => `${s.label} ${s.value} ms`).join(", ")}>
        {stages.map((s) => (
          <span key={s.key} className={`series-${s.series}`} style={{ flexGrow: s.value }} />
        ))}
      </div>
      <ul className="mix-rows">
        {stages.map((s) => (
          <li key={s.key} className={`series-${s.series}`}>
            <span className="swatch" />{s.label}
            <span className="count">{ms(s.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Body({ event }: { event: GatewayEvent }) {
  const { caller = {}, request = {}, decision = {}, classification = {}, securityScan = {}, llm = {}, performance = {} } = event;
  const labels: GatewayEvent[] = Array.isArray(classification.labels) ? classification.labels : [];
  const findings: GatewayEvent[] = Array.isArray(securityScan.findings) ? securityScan.findings : [];
  const json = JSON.stringify(event, null, 2);

  return (
    <div className="drawer-body rise">
      <div className="facts">
        <Fact label="Time">{formatTime(event.timestamp)}</Fact>
        <Fact label="Caller">
          {caller.principalId
            ? <a className="link" href={href("events", { caller: caller.principalId })}>{caller.principalId}</a>
            : "—"}
        </Fact>
        <Fact label="Route">{[request.method, request.route].filter(Boolean).join(" ") || "—"}</Fact>
        <Fact label="Client">{text(caller.clientId)}</Fact>
        <Fact label="Reason">{text(decision.reasonCode)}</Fact>
        <Fact label="HTTP status">{text(decision.httpStatus)}</Fact>
      </div>

      <Section title="Latency" aside={<span className="section-aside">{ms(performance.totalLatencyMs)} total</span>}>
        <LatencyBreakdown performance={performance} />
      </Section>

      <Section title="Classification"
        aside={classification.primaryCategory && <span className="tag">{classification.primaryCategory}</span>}>
        {labels.length === 0 ? <p className="muted">No labels were returned.</p> : (
          <ul className="scores">
            {labels.map((l, i) => (
              <li key={i}>
                <span>{text(l.name)}</span>
                <span className="score-track">
                  <span className="score-bar" style={{ width: `${Math.min(Math.max(Number(l.score) || 0, 0), 1) * 100}%` }} />
                </span>
                <span className="count">{typeof l.score === "number" ? l.score.toFixed(2) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Security scan"
        aside={securityScan.highestSeverity && <span className="tag">{securityScan.highestSeverity}</span>}>
        {findings.length === 0
          ? <p className="muted">{securityScan.performed === false ? "The scan was not run." : "No findings."}</p>
          : (
            <ul className="findings">
              {findings.map((f, i) => (
                <li key={i}>
                  <div>
                    <div className="fact-value">{text(f.category)}</div>
                    <div className="fact-label mono">{[f.ruleId, f.scanner].filter(Boolean).join(" · ")}</div>
                  </div>
                  {f.severity && <span className="tag">{f.severity}</span>}
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="LLM call">
        {llm.called === false ? <p className="muted">The request was stopped before reaching the model.</p> : (
          <div className="facts">
            <Fact label="Provider">{text(llm.provider)}</Fact>
            <Fact label="Model">{text(llm.model)}</Fact>
            <Fact label="Input tokens">{typeof llm.inputTokens === "number" ? llm.inputTokens.toLocaleString("en-US") : "—"}</Fact>
            <Fact label="Output tokens">{typeof llm.outputTokens === "number" ? llm.outputTokens.toLocaleString("en-US") : "—"}</Fact>
          </div>
        )}
      </Section>

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
        // unmount only after the slide-out animation has finished
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
