-- Verify migration 41 First Thirty CAMP eligibility columns + RPC source
-- Run in Supabase SQL editor after applying migrations.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'camp_messages'
  AND column_name IN ('first_thirty_eligible', 'first_thirty_eligibility_reason')
ORDER BY column_name;

SELECT
  pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_first_thirty_camp_exchange';

-- Expect comment / body to reference first_thirty_eligible, not reward_recommendation gate.
SELECT
  CASE
    WHEN pg_get_functiondef(p.oid) ILIKE '%first_thirty_eligible%'
     AND pg_get_functiondef(p.oid) NOT ILIKE '%reward_recommendation, 0) >= 1%'
    THEN 'ok'
    ELSE 'check_failed'
  END AS eligibility_source_ok
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_first_thirty_camp_exchange';
