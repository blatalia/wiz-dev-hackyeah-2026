import { useEffect, useMemo, useState } from "react";
import { getMe, logout, setSessionExpiredHandler, type User } from "./api";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { Events } from "./components/Events";

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = [
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];
type View = "overview" | "events";

export type TimeRange = { from: string; to: string };

export function App() {
  // undefined = still checking the session, null = not logged in
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [view, setView] = useState<View>("overview");
  const [rangeId, setRangeId] = useState<RangeId>("7d");
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    getMe().then(setUser, () => setUser(null));
  }, []);

  const range = useMemo<TimeRange>(() => {
    const days = RANGES.find((r) => r.id === rangeId)!.days;
    return {
      from: new Date(refreshedAt - days * DAY_MS).toISOString(),
      to: new Date(refreshedAt).toISOString(),
    };
  }, [rangeId, refreshedAt]);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (user === null) return <Login onLogin={(u) => { setRefreshedAt(Date.now()); setUser(u); }} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>AI Gateway Dashboard</h1>
        <nav className="tabs" aria-label="Views">
          <button className={view === "overview" ? "tab active" : "tab"} onClick={() => setView("overview")}>
            Overview
          </button>
          <button className={view === "events" ? "tab active" : "tab"} onClick={() => setView("events")}>
            Events
          </button>
        </nav>
        <div className="spacer" />
        <span className="muted">{user.email}</span>
        <button className="btn" onClick={() => logout().finally(() => setUser(null))}>
          Log out
        </button>
      </header>

      <div className="filters">
        <label>
          <span className="muted">Period</span>
          <select value={rangeId} onChange={(e) => setRangeId(e.target.value as RangeId)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => setRefreshedAt(Date.now())}>Refresh</button>
      </div>

      <main>
        {view === "overview" ? <Overview range={range} /> : <Events range={range} />}
      </main>
    </div>
  );
}
