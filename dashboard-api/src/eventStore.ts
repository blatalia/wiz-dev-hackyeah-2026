import { pool } from "./db";

export type EventFilters = {
  from?: Date;
  to?: Date;
  outcome?: string;
  principalId?: string;
  reasonCode?: string;
  category?: string;
  severity?: string;
  limit: number;
  cursor?: string;
};

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

export type StatsBucket = "day" | "hour";

export type EventStats = {
  range: { from: string; to: string };
  bucket: StatsBucket;
  totals: {
    total: number; allowed: number; flagged: number; blocked: number;
    avgLatencyMs: number | null; p95LatencyMs: number | null;
  };
  // one entry per bucket that has events; start is the bucket's first instant in UTC
  series: { start: string; allowed: number; flagged: number; blocked: number }[];
  topReasons: { reasonCode: string; count: number }[];
  topPrincipals: { principalId: string; total: number; blocked: number }[];
};

export interface EventStore {
  listEvents(f: EventFilters): Promise<{ items: EventSummary[]; nextCursor: string | null }>;
  getEvent(requestId: string): Promise<unknown | null>;
  getStats(from: Date, to: Date, bucket: StatsBucket): Promise<EventStats>;
}

export function encodeCursor(ts: Date | string, id: string) {
  const iso = typeof ts === "string" ? ts : ts.toISOString();
  return Buffer.from(`${iso}|${id}`).toString("base64url");
}

export function decodeCursor(c: string): { ts: string; id: string } | null {
  try {
    const [ts, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    if (!ts || !id || isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

function toSummary(r: any): EventSummary {
  return {
    requestId: r.request_id,
    timestamp: r.ts.toISOString(),
    principalId: r.principal_id,
    outcome: r.outcome,
    reasonCode: r.reason_code,
    category: r.primary_category,
    severity: r.severity,
    latencyMs: r.latency_ms,
    configVersion: r.config_version,
  };
}

export class PostgresEventStore implements EventStore {
  async listEvents(f: EventFilters) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (f.from) add("ts >= ?", f.from);
    if (f.to) add("ts < ?", f.to);
    if (f.outcome) add("outcome = ?", f.outcome);
    if (f.principalId) add("principal_id = ?", f.principalId);
    if (f.reasonCode) add("reason_code = ?", f.reasonCode);
    if (f.category) add("primary_category = ?", f.category);
    if (f.severity) add("severity = ?", f.severity);

    const c = f.cursor ? decodeCursor(f.cursor) : null;
    if (c) {
      params.push(c.ts, c.id);
      where.push(`(ts, request_id) < ($${params.length - 1}::timestamptz, $${params.length}::text)`);
    }

    params.push(f.limit + 1);
    const sql = `
      SELECT request_id, ts, principal_id, outcome, reason_code,
             primary_category, severity, latency_ms, config_version
      FROM gateway_events
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ts DESC, request_id DESC
      LIMIT $${params.length}`;

    const { rows } = await pool.query(sql, params);
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];

    return {
      items: page.map(toSummary),
      nextCursor: rows.length > f.limit && last ? encodeCursor(last.ts, last.request_id) : null,
    };
  }

  async getEvent(requestId: string) {
    const { rows } = await pool.query(
      "SELECT event FROM gateway_events WHERE request_id = $1", [requestId]);
    return rows[0]?.event ?? null;
  }

  async getStats(from: Date, to: Date, bucket: StatsBucket): Promise<EventStats> {
    const range = [from, to];
    const inRange = "ts >= $1 AND ts < $2";

    const [totals, series, topReasons, topPrincipals] = await Promise.all([
      pool.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE outcome = 'ALLOWED')::int AS allowed,
               count(*) FILTER (WHERE outcome = 'FLAGGED')::int AS flagged,
               count(*) FILTER (WHERE outcome = 'BLOCKED')::int AS blocked,
               round(avg(latency_ms))::int AS "avgLatencyMs",
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS "p95LatencyMs"
        FROM gateway_events WHERE ${inRange}`, range),

      pool.query(`
        SELECT to_char(date_trunc('${bucket}', ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start,
               count(*) FILTER (WHERE outcome = 'ALLOWED')::int AS allowed,
               count(*) FILTER (WHERE outcome = 'FLAGGED')::int AS flagged,
               count(*) FILTER (WHERE outcome = 'BLOCKED')::int AS blocked
        FROM gateway_events WHERE ${inRange}
        GROUP BY start ORDER BY start`, range),

      pool.query(`
        SELECT reason_code AS "reasonCode", count(*)::int AS count
        FROM gateway_events WHERE ${inRange} AND reason_code IS NOT NULL
        GROUP BY reason_code ORDER BY count DESC LIMIT 5`, range),

      pool.query(`
        SELECT principal_id AS "principalId",
               count(*)::int AS total,
               count(*) FILTER (WHERE outcome = 'BLOCKED')::int AS blocked
        FROM gateway_events WHERE ${inRange}
        GROUP BY principal_id ORDER BY blocked DESC, total DESC LIMIT 5`, range),
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      bucket,
      totals: totals.rows[0],
      series: series.rows,
      topReasons: topReasons.rows,
      topPrincipals: topPrincipals.rows,
    };
  }
}
