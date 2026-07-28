-- FENN Pre-launch Ledger — public recognition totals (read-only aggregates)
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not alter LEAF award behaviour or leaf_ledger mutability.
--
-- Public Ledger page reads via service_role. This RPC avoids scanning
-- all ledger rows in application code for aggregate metrics.

CREATE OR REPLACE FUNCTION public.get_public_leaf_recognition_totals()
RETURNS TABLE (
  current_recognised bigint,
  lifetime_recognised bigint,
  entry_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(l.amount), 0)::bigint AS current_recognised,
    COALESCE(
      SUM(CASE WHEN l.lifetime_delta > 0 THEN l.lifetime_delta ELSE 0 END),
      0
    )::bigint AS lifetime_recognised,
    COUNT(*)::bigint AS entry_count
  FROM public.leaf_ledger l;
$$;

COMMENT ON FUNCTION public.get_public_leaf_recognition_totals() IS
  'Public Ledger aggregates: current = SUM(amount); lifetime = SUM(positive lifetime_delta). service_role only.';

REVOKE ALL ON FUNCTION public.get_public_leaf_recognition_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_leaf_recognition_totals() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_leaf_recognition_totals() TO service_role;
