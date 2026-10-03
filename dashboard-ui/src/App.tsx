import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, ListFilter, LogOut, Moon, RotateCw, ShieldCheck, SlidersHorizontal, Sun } from "lucide-react";
import { getMe, logout, setSessionExpiredHandler, type User } from "./api";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { Events } from "./components/Events";
import { Config } from "./components/Config";
import { Segmented } from "./components/ui";
import { href, useRoute, type Params } from "./route";

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_INTERVAL_MS = 30_000;

const RANGES = [
  { value: "24h", label: "24 hours", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
] as const;

const VIEWS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard, sub: "Traffic and guardrail decisions across the gateway" },
  { id: "events", label: "Events", Icon: ListFilter, sub: "Every request the gateway has processed" },
  { id: "config", label: "Config", Icon: SlidersHorizontal, sub: "Switch gateway checks on or off" },
] as const;

type RangeId = (typeof RANGES)[number]["value"];
type Theme = "dark" | "light";

// quiet = this range came from a background live tick, so views update in place
export type TimeRange = { id: RangeId; label: string; from: string; to: string; quiet: boolean };

function stored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep the choice for this visit */ }
}

export function App() {
  // undefined = still checking the session, null = not logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [route, go] = useRoute();
  const [clock, setClock] = useState(() => ({ at: Date.now(), quiet: false, manual: 0 }));
  const [live, setLive] = useState(() => stored("live") !== "off");
  const [theme, setTheme] = useState<Theme>(() => (stored("ui-theme") === "dark" ? "dark" : "light"));

  const view = route.view;
  const rangeDef = RANGES.find((r) => r.value === route.params.range) ?? RANGES[1];

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    getMe().then(setUser, () => setUser(null));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store("ui-theme", theme);
  }, [theme]);

  useEffect(() => {
    store("live", live ? "on" : "off");
    if (!live || !user) return;
    const timer = setInterval(() => {
      // a hidden tab has nobody watching, so skip the request
      if (!document.hidden) setClock((c) => ({ at: Date.now(), quiet: true, manual: c.manual }));
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, user]);

  const range = useMemo<TimeRange>(() => ({
    id: rangeDef.value,
    label: rangeDef.label,
    from: new Date(clock.at - rangeDef.days * DAY_MS).toISOString(),
    to: new Date(clock.at).toISOString(),
    quiet: clock.quiet,
  }), [rangeDef, clock]);

  if (user === undefined) return <div className="splash"><RotateCw className="spinner" size={20} /></div>;
  if (user === null) return <Login onLogin={(u) => { setClock({ at: Date.now(), quiet: false, manual: 0 }); setUser(u); }} />;

  const current = VIEWS.find((v) => v.id === view)!;
  // the period travels with every link; the default one is left out of the URL
  const rangeParam = rangeDef.value === "7d" ? undefined : rangeDef.value;
  const refresh = () => setClock((c) => ({ at: Date.now(), quiet: false, manual: c.manual + 1 }));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={20} /></span>
          <div>
            <div className="brand-name">AI Gateway</div>
            <div className="brand-sub">Security console</div>
          </div>
        </div>

        <nav className="nav" aria-label="Views">
          {VIEWS.map(({ id, label, Icon }) => (
            <a key={id} className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined} href={href(id, { range: rangeParam })}>
              <Icon size={18} />
              {label}
            </a>
          ))}
        </nav>

        <div className="account">
          <span className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</span>
          <div className="account-text">
            <div className="account-email" title={user.email}>{user.email}</div>
            <div className="account-role">Administrator</div>
          </div>
          <button className="btn ghost icon" aria-label="Log out" title="Log out"
            onClick={() => logout().finally(() => setUser(null))}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="page-head">
          {/* keyed so the heading animates in when the view changes */}
          <div key={view} className="rise">
            <h1 className="page-title">{current.label}</h1>
            <p className="page-sub">{current.sub}</p>
          </div>
          <div className="spacer" />
          <div className="toolbar">
            {/* the period only scopes event data, so it is hidden on the config view */}
            {view !== "config" && (
              <>
                <button className={live ? "btn live on" : "btn live"} aria-pressed={live}
                  title={live ? "Refreshing every 30 seconds. Click to pause." : "Click to refresh every 30 seconds."}
                  onClick={() => setLive(!live)}>
                  <span className="live-dot" aria-hidden="true" />
                  {live ? "Live" : "Paused"}
                </button>
                <span className="updated">
                  Updated {new Date(clock.at).toLocaleTimeString("en-GB")}
                </span>
                <Segmented label="Period" options={RANGES} value={rangeDef.value}
                  onChange={(id) => {
                    refresh();
                    go(view, { ...route.params, range: id === "7d" ? undefined : id });
                  }} />
                <button className="btn icon" aria-label="Refresh data" title="Refresh data" onClick={refresh}>
                  {/* re-keyed on manual refresh only, so live ticks do not spin it */}
                  <RotateCw key={clock.manual} className="spin-once" size={16} />
                </button>
              </>
            )}
            <button className="btn icon" title="Switch theme"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <main key={view}>
          {view === "overview" && <Overview range={range} rangeParam={rangeParam} />}
          {view === "events" && (
            <Events range={range} params={route.params}
              setParams={(patch: Params) => go("events", { ...route.params, ...patch })} />
          )}
          {view === "config" && <Config />}
        </main>
      </div>
    </div>
  );
}
