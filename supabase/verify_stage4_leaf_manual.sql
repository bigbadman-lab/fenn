-- FENN Stage 4 — Manual verification (LOCAL / STAGING ONLY)
-- Do NOT run against production casually.
-- Apply migration 12 first, then run against a disposable profile.
--
-- Replace :profile_id with a real test profile UUID that already exists.
-- Replace :wallet with that profile's wallet_address if asserting snapshots.

-- 1) Confirm function privileges
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admin_adjust_leaf';

-- 2) Positive award via direct insert (simulates awardLeaf write path)
-- BEGIN;
-- INSERT INTO public.leaf_ledger (
--   profile_id, wallet_address, amount, lifetime_delta,
--   source_type, reason, actor_type, idempotency_key
-- ) VALUES (
--   ':profile_id'::uuid,
--   (SELECT wallet_address FROM public.profiles WHERE id = ':profile_id'::uuid),
--   5, 5, 'system', 'stage4 manual award', 'system', 'system:manual:stage4-a'
-- );
-- SELECT leaf_balance, leaf_lifetime_earned FROM public.profiles WHERE id = ':profile_id'::uuid;
-- -- Idempotent duplicate should fail unique index if inserted again with same key
-- ROLLBACK;

-- 3) Admin adjust RPC (service_role session)
-- SELECT * FROM public.admin_adjust_leaf(
--   ':profile_id'::uuid,
--   3,
--   3,
--   'stage4 manual admin adjust',
--   'admin:test',
--   'admin_adjustment:stage4-manual-1',
--   '{}'::jsonb,
--   NULL,
--   NULL
-- );
-- -- Retry same key — created=false, no second audit
-- SELECT * FROM public.admin_adjust_leaf(
--   ':profile_id'::uuid,
--   3,
--   3,
--   'stage4 manual admin adjust',
--   'admin:test',
--   'admin_adjustment:stage4-manual-1',
--   '{}'::jsonb,
--   NULL,
--   NULL
-- );
-- SELECT count(*) FROM public.admin_audit_log
-- WHERE action = 'leaf.adjust'
--   AND reason = 'stage4 manual admin adjust';

-- 4) Immutability
-- UPDATE public.leaf_ledger SET amount = 1 WHERE false; -- should error if attempted on real row
-- DELETE FROM public.leaf_ledger WHERE false;

-- 5) Reconciliation sketch
-- SELECT
--   p.leaf_balance AS cache_balance,
--   coalesce(sum(l.amount), 0) AS ledger_amount_sum,
--   p.leaf_lifetime_earned AS cache_lifetime,
--   coalesce(sum(l.lifetime_delta), 0) AS ledger_lifetime_sum
-- FROM public.profiles p
-- LEFT JOIN public.leaf_ledger l ON l.profile_id = p.id
-- WHERE p.id = ':profile_id'::uuid
-- GROUP BY p.id;
