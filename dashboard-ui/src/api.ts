const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type User = { sub: string; email: string; roles: string[] };

export type EventSummary = {
  requestId: string;
  timestamp: string;
  principalId: string | null;
  outcome: string;
  reasonCode: string | null;
  category: string | null;
  severity: string | null;
  latencyMs: number | null;
  configVersion: number | null;
};

export type EventPage = { items: EventSummary[]; nextCursor: string | null };

export type StatsBucket = "day" | "hour";

// start is the first instant of the bucket, e.g. "2026-10-03T14:00:00Z"
export type BucketCounts = { start: string; allowed: number; flagged: number; blocked: number };

export type EventStats = {
  range: { from: string; to: string };
  bucket: StatsBucket;
  totals: {
    total: number; allowed: number; flagged: number; blocked: number;
    avgLatencyMs: number | null; p95LatencyMs: number | null;
  };
  series: BucketCounts[];
  topReasons: { reasonCode: string; count: number }[];
  topPrincipals: { principalId: string; total: number; blocked: number }[];
};

export type GatewayConfig = { configId: string; flags: Record<string, boolean> };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onSessionExpired = () => {};
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

// Cookies are httpOnly, so the browser sends them itself; we only have to ask for it.
function send(path: string, init?: RequestInit) {
  return fetch(API_URL + path, { credentials: "include", ...init });
}

// One refresh at a time: the refresh token is rotated, so parallel refreshes would fail.
let refreshing: Promise<boolean> | null = null;
function refreshSession() {
  refreshing ??= send("/auth/refresh", { method: "POST" })
    .then((r) => r.ok, () => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function request<T>(path: string, init?: RequestInit, retryOn401 = true): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && retryOn401) {
    if (await refreshSession()) res = await send(path, init);
    if (res.status === 401) onSessionExpired();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export async function login(email: string, password: string) {
  const { user } = await request<{ user: { id: string; email: string; roles: string[] } }>(
    "/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    false,
  );
  return { sub: user.id, email: user.email, roles: user.roles } satisfies User;
}

export function logout() {
  return request<void>("/auth/logout", { method: "POST" }, false);
}

export async function getMe() {
  return (await request<{ user: User }>("/auth/me")).user;
}

export type EventQuery = {
  from?: string;
  to?: string;
  outcome?: string;
  principalId?: string;
  reasonCode?: string;
  severity?: string;
  cursor?: string;
  limit?: number;
};

function queryString(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getEvents(query: EventQuery) {
  return request<EventPage>("/events" + queryString(query));
}

export function getEvent(requestId: string) {
  // the gateway's event format is still settling, so the detail view reads it defensively
  return request<Record<string, any>>("/events/" + encodeURIComponent(requestId));
}

export function getStats(from: string, to: string, bucket: StatsBucket = "day") {
  return request<EventStats>("/events/stats" + queryString({ from, to, bucket }));
}

export function getConfig() {
  return request<GatewayConfig>("/config");
}

export function updateConfig(flags: Record<string, boolean>) {
  return request<GatewayConfig>("/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flags }),
  });
}
