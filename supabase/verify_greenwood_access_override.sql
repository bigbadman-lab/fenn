-- Verify Greenwood access-override admission signature.
-- Prerequisite: apply 20260728150000_32_greenwood_access_override.sql

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admit_to_greenwood';
-- expect one row: uuid, boolean
-- service_role_execute true; anon/authenticated false

-- Old single-arg overload must be gone.
SELECT COUNT(*) AS old_uuid_only_overloads
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admit_to_greenwood'
  AND pg_get_function_identity_arguments(p.oid) = 'uuid';
-- expect 0
