-- FENN Stage 12.6 — Effect execution + OAuth credential verification
-- Rollback-safe probes.
--
-- PREREQUISITES:
--   ...28_stage125_x_authority.sql
--   ...29_stage126_x_effects_execution.sql

-- ---------------------------------------------------------------------------
-- A) Tables
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_oauth_credentials'),
  ('x_oauth_pkce_sessions'),
  ('x_perception_effects')
) AS t(relname)
LEFT JOIN pg_class c ON c.relname = t.relname AND c.relkind = 'r'
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- B) Effect result columns
-- ---------------------------------------------------------------------------
SELECT 'B_EFFECT_COLS' AS section, t.col,
  CASE WHEN a.attname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('external_result_id'),
  ('completed_at'),
  ('failure_class')
) AS t(col)
LEFT JOIN pg_attribute a
  ON a.attrelid = 'public.x_perception_effects'::regclass
 AND a.attname = t.col
 AND NOT a.attisdropped;

-- ---------------------------------------------------------------------------
-- C) Uniqueness
-- ---------------------------------------------------------------------------
SELECT 'C_UNIQUE' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_oauth_credentials_slot_uidx'),
  ('x_perception_effects_idempotency_uidx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.indexname = t.indexname;

-- ---------------------------------------------------------------------------
-- D) RLS + browser revoke
-- ---------------------------------------------------------------------------
SELECT 'D_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('x_oauth_credentials', 'x_oauth_pkce_sessions');

SELECT 'D_BROWSER' AS section, t.tbl, r.rolename, p.priv,
  CASE
    WHEN has_table_privilege(r.rolename, t.tbl, p.priv) THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES
  ('public.x_oauth_credentials'),
  ('public.x_oauth_pkce_sessions')
) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);

-- ---------------------------------------------------------------------------
-- E) RPC posture
-- ---------------------------------------------------------------------------
SELECT 'E_RPC' AS section, f.fn, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, f.fn, 'EXECUTE') THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES
  ('public.claim_x_perception_effect(text)'),
  ('public.complete_x_perception_effect(uuid, text)'),
  ('public.fail_x_perception_effect(uuid, text, text)'),
  ('public.list_pending_x_perception_effects(integer)'),
  ('public.consume_x_oauth_pkce_session(text)')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- ---------------------------------------------------------------------------
-- F) Failure class check
-- ---------------------------------------------------------------------------
SELECT 'F_FAILURE_CLASS' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_effects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ambiguous%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;
