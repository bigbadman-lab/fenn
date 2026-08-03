-- THE FIRST THIRTY — verification after 20260803110000_40_first_thirty.sql

-- 1) source_type includes onboarding
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.leaf_ledger'::regclass
  AND conname = 'leaf_ledger_source_type_check';

-- 2) tables exist
SELECT to_regclass('public.first_thirty_progress') AS progress;
SELECT to_regclass('public.first_thirty_camp_exchanges') AS exchanges;

-- 3) RPC privileges
SELECT
  p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_ok,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_first_thirty_camp_exchange',
    'apply_first_thirty_first_deed'
  )
ORDER BY p.proname;
