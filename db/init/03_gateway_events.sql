-- Gateway events are stored as-is in JSONB, so the table does not depend on
-- the exact event format or on where the gateway keeps its own copy.
-- Only requestId and timestamp are required; every other column is optional
-- and exists purely to make dashboard filters fast.

-- ISO-8601 string -> timestamptz. Marked IMMUTABLE because the gateway always
-- writes timestamps in UTC with an explicit 'Z'.
CREATE FUNCTION iso_to_ts(t TEXT) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$ SELECT t::timestamptz $$;

CREATE TABLE gateway_events (
  event JSONB NOT NULL,

  -- Filled in by Postgres from the JSON on insert
  request_id       TEXT        GENERATED ALWAYS AS (event->>'requestId') STORED PRIMARY KEY,
  ts               TIMESTAMPTZ GENERATED ALWAYS AS (iso_to_ts(event->>'timestamp')) STORED NOT NULL,
  principal_id     TEXT        GENERATED ALWAYS AS (event->'caller'->>'principalId') STORED,
  outcome          TEXT        GENERATED ALWAYS AS (event->'decision'->>'outcome') STORED,
  reason_code      TEXT        GENERATED ALWAYS AS (event->'decision'->>'reasonCode') STORED,
  config_version   INT         GENERATED ALWAYS AS ((event->'decision'->>'configVersion')::int) STORED,
  primary_category TEXT        GENERATED ALWAYS AS (event->'classification'->>'primaryCategory') STORED,
  severity         TEXT        GENERATED ALWAYS AS (event->'securityScan'->>'highestSeverity') STORED,
  latency_ms       INT         GENERATED ALWAYS AS ((event->'performance'->>'totalLatencyMs')::int) STORED
);

CREATE INDEX idx_events_ts           ON gateway_events (ts DESC);
CREATE INDEX idx_events_outcome_ts   ON gateway_events (outcome, ts DESC);
CREATE INDEX idx_events_principal_ts ON gateway_events (principal_id, ts DESC);
