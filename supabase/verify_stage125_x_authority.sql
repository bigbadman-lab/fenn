-- FENN Stage 12.5 — Authority verification
-- Rollback-safe probes.
--
-- PREREQUISITES:
--   ...26_stage123_x_judgement.sql
--   ...27_stage124_x_live_sight.sql
--   ...28_stage125_x_authority.sql

-- ---------------------------------------------------------------------------
-- A) Tables
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_authorizations'),
  ('x_perception_effects')
) AS t(relname)
LEFT JOIN pg_class c ON c.relname = t.relname AND c.relkind = 'r'
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- B) Uniqueness
-- ---------------------------------------------------------------------------
SELECT 'B_UNIQUE' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_authorizations_perception_uidx'),
  ('x_perception_authorizations_judgement_uidx'),
  ('x_perception_effects_idempotency_uidx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.indexname = t.indexname;

-- ---------------------------------------------------------------------------
-- C) Constraints
-- ---------------------------------------------------------------------------
SELECT 'C_OUTCOME_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_authorizations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%permitted%'
      AND pg_get_constraintdef(oid) ILIKE '%denied%'
      AND pg_get_constraintdef(oid) ILIKE '%no_action%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'C_EFFECT_TYPE_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_effects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reply_on_x%'
      AND pg_get_constraintdef(oid) ILIKE '%write_to_wall%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'C_EFFECT_STATUS_CHECK' AS section,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.x_perception_effects'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
      AND pg_get_constraintdef(oid) ILIKE '%completed%'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ---------------------------------------------------------------------------
-- D) FKs
-- ---------------------------------------------------------------------------
SELECT 'D_FK' AS section, c.conname,
  CASE WHEN c.conname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM pg_constraint c
WHERE c.conrelid = 'public.x_perception_authorizations'::regclass
  AND c.contype = 'f';

SELECT 'D_FK_EFFECTS' AS section, c.conname,
  CASE WHEN c.conname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM pg_constraint c
WHERE c.conrelid = 'public.x_perception_effects'::regclass
  AND c.contype = 'f';

-- ---------------------------------------------------------------------------
-- E) RLS + browser revoke
-- ---------------------------------------------------------------------------
SELECT 'E_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('x_perception_authorizations', 'x_perception_effects');

SELECT 'E_BROWSER' AS section, t.tbl, r.rolename, p.priv,
  CASE
    WHEN has_table_privilege(r.rolename, t.tbl, p.priv) THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES
  ('public.x_perception_authorizations'),
  ('public.x_perception_effects')
) AS t(tbl)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolename)
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
  ('public.claim_x_perception_for_authority()'),
  ('public.persist_x_perception_authorization(uuid, uuid, text, text, text, text, text, jsonb)')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- ---------------------------------------------------------------------------
-- G) Pending-effect indexes
-- ---------------------------------------------------------------------------
SELECT 'G_INDEXES' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_effects_status_created_idx'),
  ('x_perception_effects_auth_idx'),
  ('x_perception_effects_perception_idx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.tablename = 'x_perception_effects'
 AND i.indexname = t.indexname;
