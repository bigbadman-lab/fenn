-- FENN Stage 12.3 — X judgement / intention verification
-- Rollback-safe probes.
--
-- PREREQUISITES:
--   ...24_stage122_x_perception.sql
--   ...25_stage122_ingest_status_ambiguity.sql
--   ...26_stage123_x_judgement.sql

-- ---------------------------------------------------------------------------
-- A) Tables
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_events'),
  ('x_perception_judgements')
) AS t(relname)
LEFT JOIN pg_class c ON c.relname = t.relname AND c.relkind = 'r'
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- B) Uniqueness per perception
-- ---------------------------------------------------------------------------
SELECT 'B_UNIQUE_PERCEPTION' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'x_perception_judgements'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%perception_event_id%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- C) Action / reason constraints
-- ---------------------------------------------------------------------------
SELECT 'C_ACTION_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_judgements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reply_on_x%'
      AND pg_get_constraintdef(oid) ILIKE '%do_nothing%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'C_REASON_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_judgements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%identity_unverified%'
      AND pg_get_constraintdef(oid) ILIKE '%knowledge_unavailable%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- D) FK to perception
-- ---------------------------------------------------------------------------
SELECT 'D_FK' AS section,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.x_perception_judgements'::regclass
      AND contype = 'f'
      AND confrelid = 'public.x_perception_events'::regclass
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- E) RLS + browser revoke
-- ---------------------------------------------------------------------------
SELECT 'E_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'x_perception_judgements';

SELECT 'E_BROWSER' AS section, r.rolename, p.priv,
  CASE
    WHEN has_table_privilege(r.rolename, 'public.x_perception_judgements', p.priv)
      THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);

-- ---------------------------------------------------------------------------
-- F) RPC posture
-- ---------------------------------------------------------------------------
SELECT 'F_RPC' AS section, f.fn, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, f.fn, 'EXECUTE') THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES
  ('public.claim_x_perception_for_judgement()'),
  ('public.finalize_x_perception_judgement(uuid, text, text, boolean, text, text, text[], boolean, boolean, text, text)'),
  ('public.fail_x_perception_judgement(uuid, text)')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- Expect: anon/authenticated NO_EXECUTE; service_role HAS_EXECUTE

-- ---------------------------------------------------------------------------
-- G) Indexes
-- ---------------------------------------------------------------------------
SELECT 'G_INDEXES' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_judgements_perception_uidx'),
  ('x_perception_judgements_action_created_idx'),
  ('x_perception_judgements_reason_idx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.tablename = 'x_perception_judgements'
 AND i.indexname = t.indexname;
