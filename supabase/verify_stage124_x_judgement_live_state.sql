-- FENN Stage 12.4 verification
-- SQL verification only. Rollback-safe probes (where possible).
--
-- PREREQUISITES:
--   Stage 12.3 judgement migration exists:
--     .../supabase/migrations/*_26_stage123_x_judgement.sql
--   Stage 12.4 migration exists:
--     .../supabase/migrations/20260728100000_27_stage124_x_live_sight.sql

-- ---------------------------------------------------------------------------
-- A) Tables exist
-- ---------------------------------------------------------------------------
SELECT 'A_TABLES' AS section, t.relname,
  CASE WHEN c.oid IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES ('x_perception_judgements')) AS t(relname)
LEFT JOIN pg_class c
  ON c.relname = t.relname
LEFT JOIN pg_namespace n
  ON n.oid = c.relnamespace
 AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- B) Column existence (finalization)
-- ---------------------------------------------------------------------------
SELECT 'B_FINAL_COLUMNS' AS section,
  column_name,
  CASE WHEN is_nullable = 'NO' THEN 'OK' ELSE 'OK' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'x_perception_judgements'
  AND column_name IN (
    'final_status',
    'live_state_available',
    'live_state_succeeded',
    'live_state_failed',
    'final_action',
    'final_reason_code',
    'final_reply_text',
    'final_wall_body',
    'final_engage',
    'final_identity_unverified',
    'final_model',
    'final_prompt_version',
    'finalized_at'
  );

-- ---------------------------------------------------------------------------
-- C) RLS enabled and browser grants revoked
-- ---------------------------------------------------------------------------
SELECT 'C_RLS' AS section, c.relname, c.relrowsecurity,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'x_perception_judgements';

SELECT 'D_BROWSER_GRANTS' AS section, r.rolename, p.priv,
  CASE WHEN has_table_privilege(r.rolename, 'public.x_perception_judgements', p.priv)
    THEN 'UNEXPECTED_GRANT'
    ELSE 'OK_REVOKED'
  END AS status
FROM (VALUES ('anon'), ('authenticated')) AS r(rolename)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv);

-- ---------------------------------------------------------------------------
-- E) RPC posture (claim/finalize)
-- ---------------------------------------------------------------------------
SELECT 'E_RPC' AS section, f.fn, r.rolename,
  CASE
    WHEN has_function_privilege(r.rolename, f.fn, 'EXECUTE') THEN 'HAS_EXECUTE'
    ELSE 'NO_EXECUTE'
  END AS status
FROM (VALUES
  ('public.claim_x_perception_judgement_for_live_state()'),
  ('public.finalize_x_perception_judgement_with_live_state(uuid, text, boolean, text[], text[], text, text, boolean, text, text, boolean, text, text)')
) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolename);

-- ---------------------------------------------------------------------------
-- F) Indexes
-- ---------------------------------------------------------------------------
SELECT 'F_INDEXES' AS section, t.indexname,
  CASE WHEN i.indexname IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES
  ('x_perception_judgements_final_status_idx'),
  ('x_perception_judgements_live_available_idx')
) AS t(indexname)
LEFT JOIN pg_indexes i
  ON i.schemaname = 'public'
 AND i.tablename = 'x_perception_judgements'
 AND i.indexname = t.indexname;

