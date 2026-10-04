import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  decodeCursor, encodeCursor,
  type EventFilters, type EventStats, type EventStore, type EventSummary, type StatsBucket,
} from "./eventStore";

const PK = "pk";
const SK = "sk";
const DAY_PREFIX = "DAY#";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_DAYS = 90;

type Item = Record<string, any>;

const dayOf = (iso: string) => iso.slice(0, 10);

function daysDesc(newest: string, oldest: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(newest); t >= Date.parse(oldest); t -= DAY_MS) {
    days.push(dayOf(new Date(t).toISOString()));
  }
  return days;
}

function toSummary(e: Item): EventSummary {
  return {
    requestId: e.requestId,
    timestamp: e.timestamp,
    eventType: e.eventType ?? e.event?.event_type ?? null,
    principalId: e.caller?.principalId ?? null,
    outcome: e.decision?.outcome,
    reasonCode: e.decision?.reasonCode ?? e.event?.reason ?? null,
    category: e.classification?.primaryCategory ?? null,
    severity: e.securityScan?.highestSeverity ?? null,
    latencyMs: e.performance?.totalLatencyMs ?? null,
    cost: typeof e.event?.cost === "number" ? e.event.cost : null,
    configVersion: e.decision?.configVersion ?? null,
  };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const pos = p * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo));
}

export class DynamoEventStore implements EventStore {
  private doc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT || undefined }));
  private table = process.env.EVENTS_TABLE || "ai-gateway-request-events";
  private requestIdIndex = process.env.EVENTS_REQUEST_ID_INDEX || undefined;

  private async queryDay(
    day: string, lo: string, hi: string,
    filter: { expression?: string; names: Record<string, string>; values: Record<string, unknown> },
    pageLimit: number | undefined,
    onItem: (item: Item) => boolean,
  ) {
    if (lo > hi) return true;
    let startKey: Item | undefined;
    do {
      const out = await this.doc.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :lo AND :hi",
        FilterExpression: filter.expression,
        ExpressionAttributeNames: { "#pk": PK, "#sk": SK, ...filter.names },
        ExpressionAttributeValues: { ":pk": DAY_PREFIX + day, ":lo": lo, ":hi": hi, ...filter.values },
        ScanIndexForward: false,
        Limit: pageLimit,
        ExclusiveStartKey: startKey,
      }));
      for (const item of out.Items ?? []) {
        if (!onItem(item)) return false;
      }
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return true;
  }

  async listEvents(f: EventFilters) {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const conditions: string[] = [];
    const add = (path: string[], value: unknown) => {
      if (value === undefined) return;
      for (const p of path) names[`#${p}`] = p;
      values[`:f${conditions.length}`] = value;
      conditions.push(`${path.map((p) => `#${p}`).join(".")} = :f${conditions.length}`);
    };
    add(["decision", "outcome"], f.outcome);
    add(["eventType"], f.eventType);
    add(["caller", "principalId"], f.principalId);
    add(["decision", "reasonCode"], f.reasonCode);
    add(["classification", "primaryCategory"], f.category);
    add(["securityScan", "highestSeverity"], f.severity);
    const filter = { expression: conditions.join(" AND ") || undefined, names, values };

    const c = f.cursor ? decodeCursor(f.cursor) : null;
    const cursorSk = c ? `${c.ts}#${c.id}` : null;
    const fromIso = f.from?.toISOString();
    const upper = cursorSk ?? f.to?.toISOString();

    const newestDay = dayOf(upper ?? new Date().toISOString());
    const oldestDay = fromIso
      ? dayOf(fromIso)
      : dayOf(new Date(Date.parse(newestDay) - MAX_LOOKBACK_DAYS * DAY_MS).toISOString());

    const found: Item[] = [];
    for (const day of daysDesc(newestDay, oldestDay)) {
      const lo = fromIso && dayOf(fromIso) === day ? fromIso : day;
      const hi = upper && dayOf(upper) === day ? upper : `${day}~`;
      const pageLimit = filter.expression ? undefined : f.limit + 2 - found.length;
      const more = await this.queryDay(day, lo, hi, filter, pageLimit, (item) => {
        if (item[SK] !== cursorSk) found.push(item);
        return found.length <= f.limit;
      });
      if (!more) break;
    }

    const page = found.slice(0, f.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toSummary),
      nextCursor: found.length > f.limit && last ? encodeCursor(last.timestamp, last.requestId) : null,
    };
  }

  async getEvent(requestId: string) {
    if (this.requestIdIndex) {
      const out = await this.doc.send(new QueryCommand({
        TableName: this.table,
        IndexName: this.requestIdIndex,
        KeyConditionExpression: "#id = :id",
        ExpressionAttributeNames: { "#id": "requestId" },
        ExpressionAttributeValues: { ":id": requestId },
        Limit: 1,
      }));
      return out.Items?.[0] ?? null;
    }

    let startKey: Item | undefined;
    do {
      const out = await this.doc.send(new ScanCommand({
        TableName: this.table,
        FilterExpression: "#id = :id",
        ExpressionAttributeNames: { "#id": "requestId" },
        ExpressionAttributeValues: { ":id": requestId },
        ExclusiveStartKey: startKey,
      }));
      if (out.Items?.length) return out.Items[0];
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return null;
  }

  async getStats(from: Date, to: Date, bucket: StatsBucket): Promise<EventStats> {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const totals = { total: 0, allowed: 0, blocked: 0 };
    const series = new Map<string, { start: string; allowed: number; blocked: number }>();
    const reasons = new Map<string, number>();
    const principals = new Map<string, { principalId: string; total: number; blocked: number }>();
    const latencies: number[] = [];
    const types = new Map<string, { eventType: string; total: number; blocked: number }>();
    let cost: number | null = null;

    for (const day of daysDesc(dayOf(toIso), dayOf(fromIso))) {
      const lo = dayOf(fromIso) === day ? fromIso : day;
      const hi = dayOf(toIso) === day ? toIso : `${day}~`;
      await this.queryDay(day, lo, hi, { names: {}, values: {} }, undefined, (e) => {
        const s = toSummary(e);
        const key = ({ ALLOWED: "allowed", BLOCKED: "blocked" } as const)[s.outcome as string];

        totals.total++;
        const utc = new Date(s.timestamp).toISOString();
        const start = bucket === "hour" ? `${utc.slice(0, 13)}:00:00Z` : `${utc.slice(0, 10)}T00:00:00Z`;
        const d = series.get(start) ?? { start, allowed: 0, blocked: 0 };
        series.set(start, d);
        if (key) { totals[key]++; d[key]++; }

        if (s.reasonCode) reasons.set(s.reasonCode, (reasons.get(s.reasonCode) ?? 0) + 1);
        if (s.principalId) {
          const p = principals.get(s.principalId) ?? { principalId: s.principalId, total: 0, blocked: 0 };
          principals.set(s.principalId, p);
          p.total++;
          if (key === "blocked") p.blocked++;
        }
        if (typeof s.latencyMs === "number") latencies.push(s.latencyMs);
        if (s.cost !== null) cost = (cost ?? 0) + s.cost;
        if (s.eventType) {
          const t = types.get(s.eventType) ?? { eventType: s.eventType, total: 0, blocked: 0 };
          types.set(s.eventType, t);
          t.total++;
          if (key === "blocked") t.blocked++;
        }
        return true;
      });
    }

    latencies.sort((a, b) => a - b);
    return {
      range: { from: fromIso, to: toIso },
      bucket,
      totals: {
        ...totals,
        avgLatencyMs: latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        p95LatencyMs: percentile(latencies, 0.95),
        totalCost: cost === null ? null : Math.round(cost * 1e6) / 1e6,
      },
      byType: [...types.values()].sort((a, b) => b.total - a.total || a.eventType.localeCompare(b.eventType)),
      series: [...series.values()].sort((a, b) => a.start.localeCompare(b.start)),
      topReasons: [...reasons].map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode)).slice(0, 3),
      topPrincipals: [...principals.values()]
        .sort((a, b) => b.blocked - a.blocked || b.total - a.total).slice(0, 5),
    };
  }
}
