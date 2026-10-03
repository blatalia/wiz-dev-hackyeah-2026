CREATE FUNCTION iso_to_ts(t TEXT) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$ SELECT t::timestamptz $$;

CREATE TABLE gateway_events (
  event JSONB NOT NULL,

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
