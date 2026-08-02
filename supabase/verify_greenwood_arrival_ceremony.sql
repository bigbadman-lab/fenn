-- Verify Greenwood arrival ceremony column + completion RPC.
-- Prerequisite: apply 20260802100000_38_greenwood_arrival_ceremony.sql

-- Column exists
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'greenwood_arrival_ceremony_completed_at';
-- expect one row, timestamptz, YES

-- Existing members backfilled (no pending ceremony among current members)
SELECT COUNT(*) AS members_missing_ceremony_completion
FROM public.profiles
WHERE greenwood_entered_at IS NOT NULL
  AND greenwood_arrival_ceremony_completed_at IS NULL;
-- expect 0 immediately after migration apply

-- RPC signature + grants
SELECT
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'complete_greenwood_arrival_ceremony';
-- expect one row: uuid; service_role true; anon/authenticated false

-- Constraint present
SELECT conname
FROM pg_constraint
WHERE conname = 'profiles_greenwood_arrival_ceremony_member_only';
-- expect one row
