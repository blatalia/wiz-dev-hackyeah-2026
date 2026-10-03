import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, ListFilter, LogOut, Moon, RotateCw, ShieldCheck, SlidersHorizontal, Sun } from "lucide-react";
import { getMe, logout, setSessionExpiredHandler, type User } from "./api";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { Events } from "./components/Events";
import { Config } from "./components/Config";
import { Segmented } from "./components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;

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
type View = (typeof VIEWS)[number]["id"];
type Theme = "dark" | "light";

export type TimeRange = { from: string; to: string };

function storedTheme(): Theme {
  try {
    return localStorage.getItem("theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function App() {
  // undefined = still checking the session, null = not logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>("overview");
  const [rangeId, setRangeId] = useState<RangeId>("7d");
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    getMe().then(setUser, () => setUser(null));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* storage unavailable: keep the choice for this visit */ }
  }, [theme]);

  const range = useMemo<TimeRange>(() => {
    const days = RANGES.find((r) => r.value === rangeId)!.days;
    return {
      from: new Date(refreshedAt - days * DAY_MS).toISOString(),
      to: new Date(refreshedAt).toISOString(),
    };
  }, [rangeId, refreshedAt]);

  if (user === undefined) return <div className="splash"><RotateCw className="spinner" size={20} /></div>;
  if (user === null) return <Login onLogin={(u) => { setRefreshedAt(Date.now()); setUser(u); }} />;

  const current = VIEWS.find((v) => v.id === view)!;

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
            <button key={id} className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
              <Icon size={18} />
              {label}
            </button>
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
                <span className="updated">
                  Updated {new Date(refreshedAt).toLocaleTimeString("en-GB")}
                </span>
                <Segmented label="Period" options={RANGES} value={rangeId} onChange={setRangeId} />
                <button className="btn icon" aria-label="Refresh data" title="Refresh data"
                  onClick={() => setRefreshedAt(Date.now())}>
                  <RotateCw key={refreshedAt} className="spin-once" size={16} />
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
          {view === "overview" && <Overview range={range} />}
          {view === "events" && <Events range={range} />}
          {view === "config" && <Config />}
        </main>
      </div>
    </div>
  );
}
