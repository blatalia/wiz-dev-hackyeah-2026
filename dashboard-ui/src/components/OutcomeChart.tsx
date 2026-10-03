import { useEffect, useRef, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import type { DayCounts } from "../api";
import { OUTCOMES } from "./OutcomeBadge";
import { stagger } from "./ui";

const HEIGHT = 300;
const M = { top: 12, right: 8, bottom: 28, left: 44 };
const MAX_BAR = 24;
const GAP = 2; // surface gap between stacked segments
const RADIUS = 4;
const TOOLTIP_W = 176;

function formatDay(day: string) {
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

// Round axis steps: 1, 2, 5, 10, 20, 50, ...
function niceStep(max: number, ticks: number) {
  const rough = Math.max(max, 1) / ticks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find((m) => m * pow >= rough)! * pow;
  return Math.max(step, 1);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Column segment with a rounded data-end, square at the bottom
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function OutcomeChart({ days }: { days: DayCounts[] }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const plotW = Math.max(width - M.left - M.right, 0);
  const plotH = HEIGHT - M.top - M.bottom;
  const maxTotal = Math.max(...days.map((d) => d.allowed + d.flagged + d.blocked), 0);
  const step = niceStep(maxTotal, 4);
  const yMax = Math.max(Math.ceil(maxTotal / step) * step, step);
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  const band = days.length ? plotW / days.length : 0;
  const barW = Math.min(MAX_BAR, band * 0.6);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(Math.floor(plotW / 64), 1)));

  const activeDay = active !== null ? days[active] : null;
  const activeX = active !== null ? M.left + band * (active + 0.5) : 0;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Requests per day</h2>
          <p className="card-sub">Stacked by gateway decision, days in UTC</p>
        </div>
        <button className="btn small" onClick={() => setAsTable(!asTable)}>
          {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
          {asTable ? "Chart" : "Table"}
        </button>
      </div>

      <ul className="legend" style={{ marginBottom: 12 }}>
        {OUTCOMES.map((o) => (
          <li key={o.key} className={`status-${o.key}`}><span className="swatch" />{o.label}</li>
        ))}
      </ul>

      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th><th className="num">Allowed</th><th className="num">Flagged</th><th className="num">Blocked</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{formatDay(d.day)}</td>
                  <td className="num">{d.allowed.toLocaleString("en-US")}</td>
                  <td className="num">{d.flagged.toLocaleString("en-US")}</td>
                  <td className="num">{d.blocked.toLocaleString("en-US")}</td>
                  <td className="num">{(d.allowed + d.flagged + d.blocked).toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={ref} onPointerLeave={() => setActive(null)}>
          {width > 0 && (
            <svg width={width} height={HEIGHT} role="img" aria-label="Stacked columns: requests per day by outcome">
              {ticks.map((t) => (
                <g key={t}>
                  <line className={t === 0 ? "axis-line" : "grid-line"} x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
                  <text className="tick" x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle">
                    {t.toLocaleString("en-US")}
                  </text>
                </g>
              ))}

              {days.map((d, i) => {
                const x = M.left + band * i + (band - barW) / 2;
                const segments = OUTCOMES.map((o) => ({ key: o.key, value: d[o.key] })).filter((s) => s.value > 0);
                let below = 0;
                return (
                  <g key={d.day} className={active !== null && active !== i ? "dim" : undefined}>
                    <rect className={active === i ? "band on" : "band"} rx={8}
                      x={M.left + band * i + 2} y={M.top} width={Math.max(band - 4, 0)} height={plotH} />
                    {/* columns grow up from the baseline, one after another */}
                    <g className="col" style={{ ...stagger(i), transformOrigin: `0px ${y(0)}px` }}>
                      {segments.map((s, si) => {
                        const bottom = y(below);
                        below += s.value;
                        const top = y(below);
                        // every segment above the first gives up GAP px so the surface shows through
                        const h = Math.max(bottom - top - (si > 0 ? GAP : 0), 1);
                        const isTop = si === segments.length - 1;
                        return isTop
                          ? <path key={s.key} className={`seg status-${s.key}`} d={topRounded(x, top, barW, h)} />
                          : <rect key={s.key} className={`seg status-${s.key}`} x={x} y={top} width={barW} height={h} />;
                      })}
                    </g>
                    {i % labelEvery === 0 && (
                      <text className="tick" x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle">{formatDay(d.day)}</text>
                    )}
                    {/* hit target is the whole band, not just the painted column */}
                    <rect
                      className="hit" x={M.left + band * i} y={M.top} width={band} height={plotH}
                      tabIndex={0}
                      aria-label={`${formatDay(d.day)}: ${d.allowed} allowed, ${d.flagged} flagged, ${d.blocked} blocked`}
                      onPointerMove={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    />
                    <rect className="focus-ring" rx={8}
                      x={M.left + band * i + 2} y={M.top} width={Math.max(band - 4, 0)} height={plotH} />
                  </g>
                );
              })}
            </svg>
          )}

          {activeDay && (
            <div
              className="tooltip"
              style={{
                width: TOOLTIP_W,
                // beside the column, flipped to the left when it would run off the edge
                left: activeX + barW / 2 + 14 + TOOLTIP_W <= width
                  ? activeX + barW / 2 + 14
                  : Math.max(activeX - barW / 2 - 14 - TOOLTIP_W, 0),
                top: M.top + 4,
              }}
            >
              <div className="tooltip-title">{formatDay(activeDay.day)}</div>
              {[...OUTCOMES].reverse().map((o) => (
                <div className={`tooltip-row status-${o.key}`} key={o.key}>
                  <span className="key" />
                  <strong>{activeDay[o.key].toLocaleString("en-US")}</strong>
                  <span className="muted">{o.label}</span>
                </div>
              ))}
              <div className="tooltip-row total">
                <span className="key" style={{ background: "transparent" }} />
                <strong>{(activeDay.allowed + activeDay.flagged + activeDay.blocked).toLocaleString("en-US")}</strong>
                <span className="muted">Total</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
