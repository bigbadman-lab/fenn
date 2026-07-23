-- FENN Stage 7.4 — Manual verification for grant_camp_message_reward
-- Run after applying 20260723140000_15_stage7_camp_reward_rpc.sql
-- Does not award live LEAF unless you deliberately call the RPC with a real message.

-- 1) Caps seeded
SELECT slug, daily_leaf_cap
FROM public.camp_characters
WHERE slug IN ('fenn', 'wren', 'rook')
ORDER BY slug;
-- expect daily_leaf_cap = 5

SELECT key, value
FROM public.app_settings
WHERE key IN ('camp.global_daily_leaf_cap', 'camp.reward_cooldown_seconds')
ORDER BY key;
-- expect 10 and 60

-- 2) Execute privileges (service_role only)
SELECT
  p.proname,
  r.rolname AS grantee,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname = 'grant_camp_message_reward'
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY r.rolname;
-- anon/authenticated: false; service_role: true

-- 3) Function search_path
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'grant_camp_message_reward';
-- expect SECURITY INVOKER, search_path=public

-- 4) Idempotency key shape (documentation check)
-- camp_message:<assistant_message_uuid>:reward
SELECT 'camp_message:' || '00000000-0000-4000-8000-000000000001'::text || ':reward'
  AS expected_key;
