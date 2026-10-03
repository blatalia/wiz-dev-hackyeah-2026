import { Router } from "express";
import { PostgresEventStore, decodeCursor, type EventStore } from "../eventStore";
import { DynamoEventStore } from "../dynamoEventStore";

const store: EventStore = process.env.EVENT_STORE === "dynamo"
  ? new DynamoEventStore()
  : new PostgresEventStore();
export const eventsRouter = Router();

const OUTCOMES = ["ALLOWED", "FLAGGED", "BLOCKED"];
const DAY_MS = 24 * 60 * 60 * 1000;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function parseDate(v: unknown): Date | undefined | null {
  const s = str(v);
  if (s === undefined) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// GET /events/stats
eventsRouter.get("/stats", async (req, res) => {
  const to = parseDate(req.query.to) ?? new Date();
  const from = parseDate(req.query.from) ?? new Date(to.getTime() - 7 * DAY_MS);
  if (from >= to) {
    res.status(400).json({ error: "'from' must be earlier than 'to'" });
    return;
  }
  const bucket = str(req.query.bucket) ?? "day";
  if (bucket !== "day" && bucket !== "hour") {
    res.status(400).json({ error: "'bucket' must be 'day' or 'hour'" });
    return;
  }
  // hourly buckets over a long range would return thousands of points
  if (bucket === "hour" && to.getTime() - from.getTime() > 3 * DAY_MS) {
    res.status(400).json({ error: "'bucket=hour' supports ranges up to 3 days" });
    return;
  }
  res.json(await store.getStats(from, to, bucket));
});

// GET /events
eventsRouter.get("/", async (req, res) => {
  const q = req.query;

  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from === null || to === null) {
    res.status(400).json({ error: "'from' and 'to' must be ISO dates" });
    return;
  }

  const outcome = str(q.outcome)?.toUpperCase();
  if (outcome && !OUTCOMES.includes(outcome)) {
    res.status(400).json({ error: `'outcome' must be one of ${OUTCOMES.join(", ")}` });
    return;
  }

  const cursor = str(q.cursor);
  if (cursor && !decodeCursor(cursor)) {
    res.status(400).json({ error: "Invalid cursor" });
    return;
  }

  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);

  res.json(await store.listEvents({
    from, to, outcome, cursor, limit,
    principalId: str(q.principalId),
    reasonCode: str(q.reasonCode),
    category: str(q.category),
    severity: str(q.severity)?.toUpperCase(),
  }));
});

// GET /events/:requestId
eventsRouter.get("/:requestId", async (req, res) => {
  const event = await store.getEvent(req.params.requestId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
});
