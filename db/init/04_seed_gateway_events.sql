WITH base AS (
  SELECT
    i,
    date_trunc('milliseconds', now() - random() * interval '30 days') AS t,
    'req_' || upper(substr(md5(random()::text || i), 1, 14))  AS request_id,
    'user_' || (12340 + floor(random() * 6)::int)             AS principal_id,
    random()                                                  AS r_outcome,
    floor(random() * 4)::int                                  AS r_threat,
    random()                                                  AS r_score,
    (20 + floor(random() * 60))::int                          AS scan_ms,
    (400 + floor(random() * 2500))::int                       AS llm_ms,
    (200 + floor(random() * 3000))::int                       AS input_chars
  FROM generate_series(1, 2100) AS i
),
shaped AS (
  SELECT *,
    to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts_iso,
    to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD')                   AS day,
    CASE WHEN r_outcome < 0.80 THEN 'ALLOWED' ELSE 'BLOCKED' END AS outcome,
    (ARRAY['prompt-injection', 'data-exfiltration-attempt',
           'confidential-data', 'pii'])[r_threat + 1] AS threat,
    (ARRAY['INJECTION-001', 'EXFIL-001',
           'CONFIDENTIAL-001', 'PII-001'])[r_threat + 1] AS rule_id
  FROM base
)
INSERT INTO gateway_events (event)
SELECT jsonb_build_object(
  'pk',         'DAY#' || day,
  'sk',         ts_iso || '#' || request_id,
  'entityType', 'GATEWAY_REQUEST_EVENT',
  'requestId',  request_id,
  'timestamp',  ts_iso,
  'caller', jsonb_build_object(
    'principalId',  principal_id,
    'clientId',     'agent-client',
    'authMethod',   'jwt',
    'sourceIpHash', 'sha256:' || md5(principal_id)
  ),
  'request', jsonb_build_object(
    'route',            '/v1/chat/completions',
    'method',           'POST',
    'inputCharacters',  input_chars,
    'inputContentHash', 'sha256:' || md5(request_id)
  ),
  'decision', jsonb_build_object(
    'outcome',       outcome,
    'httpStatus',    CASE outcome WHEN 'BLOCKED' THEN 403 ELSE 200 END,
    'reasonCode',    CASE WHEN outcome = 'ALLOWED' THEN NULL
                          ELSE upper(replace(threat, '-', '_')) END,
    'configVersion', 7
  ),
  'classification', jsonb_build_object(
    'primaryCategory', CASE WHEN outcome = 'ALLOWED' THEN 'benign' ELSE threat END,
    'labels', CASE WHEN outcome = 'ALLOWED'
      THEN jsonb_build_array(jsonb_build_object(
             'name', 'benign', 'score', round((0.90 + r_score * 0.09)::numeric, 2)))
      ELSE jsonb_build_array(jsonb_build_object(
             'name', threat, 'score', round((0.60 + r_score * 0.39)::numeric, 2)))
    END
  ),
  'securityScan', jsonb_build_object(
    'performed',       true,
    'flagged',         outcome <> 'ALLOWED',
    'highestSeverity', CASE outcome WHEN 'BLOCKED' THEN 'HIGH' ELSE 'NONE' END,
    'findings', CASE WHEN outcome = 'ALLOWED' THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
             'scanner',  'security-scanner',
             'ruleId',   rule_id,
             'severity', CASE outcome WHEN 'BLOCKED' THEN 'HIGH' ELSE 'MEDIUM' END,
             'category', threat))
    END
  ),
  'llm', jsonb_build_object(
    'called',         outcome <> 'BLOCKED',
    'provider',       'external-llm',
    'model',          'model-name',
    'providerStatus', CASE WHEN outcome = 'BLOCKED' THEN NULL ELSE 200 END,
    'inputTokens',    CASE WHEN outcome = 'BLOCKED' THEN NULL ELSE input_chars / 4 END,
    'outputTokens',   CASE WHEN outcome = 'BLOCKED' THEN NULL ELSE 100 + llm_ms / 10 END
  ),
  'performance', jsonb_build_object(
    'totalLatencyMs',          scan_ms + CASE WHEN outcome = 'BLOCKED' THEN 0 ELSE llm_ms END,
    'classificationLatencyMs', scan_ms * 7 / 10,
    'securityScanLatencyMs',   scan_ms - scan_ms * 7 / 10,
    'llmLatencyMs',            CASE WHEN outcome = 'BLOCKED' THEN NULL ELSE llm_ms END
  ),
  'outcomeDay',      outcome || '#' || day,
  'callerTimestamp', principal_id || '#' || ts_iso,
  'expiresAt',       extract(epoch FROM t + interval '90 days')::bigint
)
FROM shaped;
