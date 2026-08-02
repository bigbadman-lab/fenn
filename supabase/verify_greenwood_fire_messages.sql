-- Verify Greenwood Fire messages (FENN SPEAKS).
-- Prerequisite: apply 20260802120000_39_greenwood_fire_messages.sql

-- Table + unique published index
SELECT to_regclass('public.greenwood_fire_messages') IS NOT NULL AS table_exists;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'greenwood_fire_messages_one_published_uidx';

-- Exactly one published after seed
SELECT COUNT(*) AS published_count
FROM public.greenwood_fire_messages
WHERE status = 'published';
-- expect 1

SELECT left(body, 40) AS body_preview, status, published_at IS NOT NULL AS has_published_at
FROM public.greenwood_fire_messages
WHERE status = 'published';
-- expect seed body starting with "The fire is small."

-- RPC grants
SELECT
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'publish_greenwood_fire_message';
-- expect uuid, uuid; service_role true; anon/authenticated false
