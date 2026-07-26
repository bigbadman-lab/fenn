-- FENN Stage 12.2 — X perception verification
-- Rollback-safe probes. Does not permanently insert QA rows beyond ON CONFLICT no-ops.
--
-- PREREQUISITE:
--   supabase/migrations/20260726190000_24_stage122_x_perception.sql

-- ---------------------------------------------------------------------------
-- A) Tables exist
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_events'),
  ('x_poll_state')
) AS t(relname)
LEFT JOIN pg_class c ON c.relname = t.relname
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  AND c.relkind = 'r';

-- ---------------------------------------------------------------------------
-- B) Uniqueness on x_post_id
-- ---------------------------------------------------------------------------
SELECT 'B_UNIQUE_X_POST_ID' AS section,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'x_perception_events'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%x_post_id%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- C) Lifecycle check constraint
-- ---------------------------------------------------------------------------
SELECT 'C_STATUS_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.x_perception_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
      AND pg_get_constraintdef(oid) ILIKE '%processing%'
      AND pg_get_constraintdef(oid) ILIKE '%processed%'
      AND pg_get_constraintdef(oid) ILIKE '%failed%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- D) RLS enabled
-- ---------------------------------------------------------------------------
SELECT 'D_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('x_perception_events', 'x_poll_state');

-- ---------------------------------------------------------------------------
-- E) Browser privileges revoked
-- ---------------------------------------------------------------------------
SELECT 'E_BROWSER_TABLE' AS section, t.tbl, r.rolename, p.priv,
  CASE
    WHEN has_table_privilege(r.rolename, t.tbl, p.priv) THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES
  ('public.x_perception_events'),
  ('public.x_poll_state')
) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
ORDER BY t.tbl, r.rolename, p.priv;

-- ---------------------------------------------------------------------------
-- F) Ingest RPC execute posture
-- ---------------------------------------------------------------------------
SELECT 'F_RPC' AS section, r.rolename,
  CASE
    WHEN has_function_privilege(
      r.rolename,
      'public.ingest_x_perception_event(text, text, text, text, text, text, text, text[], timestamptz)',
      'EXECUTE'
    ) THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- Expect: anon/authenticated NO_EXECUTE; service_role HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- G) Indexes for pending lookup / external ids
-- ---------------------------------------------------------------------------
SELECT 'G_INDEXES' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_events_x_post_id_uidx'),
  ('x_perception_events_status_received_idx'),
  ('x_perception_events_author_idx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.tablename = 'x_perception_events'
 AND i.indexname = t.indexname;

-- ---------------------------------------------------------------------------
-- H) Poll state seed row
-- ---------------------------------------------------------------------------
SELECT 'H_POLL_SEED' AS section, key,
  CASE WHEN key = 'mentions_askfenn' THEN 'OK' ELSE 'UNEXPECTED' END AS status
FROM public.x_poll_state
WHERE key = 'mentions_askfenn';

-- ---------------------------------------------------------------------------
-- I) Idempotent ingest smoke (rollback)
-- ---------------------------------------------------------------------------
BEGIN;
SELECT * FROM public.ingest_x_perception_event(
  'stage122_verify_post_1',
  'mention',
  'stage122_author_1',
  'verify_user',
  'Verify User',
  'hello @askfenn — verification only',
  NULL,
  '{}'::text[],
  timezone('utc', now())
);

SELECT * FROM public.ingest_x_perception_event(
  'stage122_verify_post_1',
  'mention',
  'stage122_author_1',
  'verify_user',
  'Verify User',
  'hello @askfenn — verification only',
  NULL,
  '{}'::text[],
  timezone('utc', now())
);
-- Expect first created=true, second created=false
ROLLBACK;
