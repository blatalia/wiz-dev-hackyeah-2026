import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

export function stagger(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useCountUp(value: number, duration = 900) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min((now - started) / duration, 1);
      current.current = from + (value - from) * (1 - (1 - p) ** 4);
      setShown(current.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}

export function Num({ value, digits = 0 }: { value: number; digits?: number }) {
  const shown = useCountUp(value);
  return (
    <>{shown.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}</>
  );
}

export function Delta({ current, previous, period }: { current: number; previous: number; period: string }) {
  if (previous === 0) {
    return <span className="delta">{current === 0 ? `No change vs ${period}` : `Nothing in ${period}`}</span>;
  }
  const change = ((current - previous) / previous) * 100;
  const Icon = Math.abs(change) < 0.05 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="delta" title={`${previous.toLocaleString("en-US")} in ${period}`}>
      <Icon size={14} />
      <strong>{Math.abs(change).toFixed(1)}%</strong> vs {period}
    </span>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const W = 100, H = 32, PAD = 3;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - PAD - (v / max) * (H - PAD * 2),
  ]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-area" d={`${line} L${W},${H} L0,${H} Z`} />
      <path className="spark-line" d={line} />
    </svg>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const at = Math.max(options.findIndex((o) => o.value === value), 0);
  return (
    <div className="segmented" role="group" aria-label={label}
      style={{ "--n": options.length, "--at": at } as CSSProperties}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function State({ Icon, title, children, action, tone = "neutral" }: {
  Icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div className={`state ${tone}`} role={tone === "error" ? "alert" : undefined}>
      <span className="state-icon"><Icon size={22} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function highlightJson(json: string): ReactNode[] {
  const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of json.matchAll(token)) {
    const i = m.index;
    if (i > last) out.push(json.slice(last, i));
    if (m[1] && m[2]) out.push(<span key={i} className="j-key">{m[1]}</span>, m[2]);
    else if (m[1]) out.push(<span key={i} className="j-str">{m[1]}</span>);
    else if (m[3]) out.push(<span key={i} className="j-lit">{m[3]}</span>);
    else out.push(<span key={i} className="j-num">{m[0]}</span>);
    last = i + m[0].length;
  }
  out.push(json.slice(last));
  return out;
}
