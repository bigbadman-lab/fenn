-- Outlaw Invite — verification after 20260803130000_42_outlaw_invite.sql

-- 1) invite_code uniqueness + format on profiles
SELECT
  conname,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND conname = 'profiles_invite_code_format';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'profiles_invite_code_uidx';

SELECT count(*) AS profiles_missing_invite_code
FROM public.profiles
WHERE invite_code IS NULL OR length(trim(invite_code)) = 0;

-- 2) leaf_ledger source_type includes invite
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.leaf_ledger'::regclass
  AND conname = 'leaf_ledger_source_type_check';

-- 3) outlaw_invites constraints
SELECT to_regclass('public.outlaw_invites') AS outlaw_invites;
SELECT to_regclass('public.outlaw_invite_retries') AS outlaw_invite_retries;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.outlaw_invites'::regclass
ORDER BY conname;

-- 4) RPC privileges: service_role only
SELECT
  p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_ok,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'register_outlaw_invite',
    'lookup_outlaw_invite_code',
    'generate_outlaw_invite_code'
  )
ORDER BY p.proname;

-- 5) RLS enabled
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('outlaw_invites', 'outlaw_invite_retries')
ORDER BY c.relname;

-- 6) Table grants: no anon/authenticated mutation
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'outlaw_invites'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

-- 7) Greenwood threshold unchanged
SELECT key, value
FROM public.app_settings
WHERE key = 'greenwood.lifetime_leaf_threshold';

-- 8) Idempotency key pattern note (manual):
-- OUTLAW: outlaw_invite:<invited_profile_id>:reward
-- Cap: 10 rewarded / 5 LEAF each
