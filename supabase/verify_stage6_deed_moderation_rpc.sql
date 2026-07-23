-- FENN Stage 6.4 DB blocker — manual RPC verification
--
-- FIRST: apply supabase/migrations/20260723120000_13_stage6_deed_moderation_rpc.sql
--        in the Supabase SQL editor (or your migration runner).
-- THEN: run this file.
--
-- Replace placeholder UUIDs/wallets with real local fixtures.
-- Do NOT run against production without explicit authorisation.

-- ---------------------------------------------------------------------------
-- 0) Confirm migration 13 objects exist
-- ---------------------------------------------------------------------------
SELECT
  to_regprocedure('public.approve_deed_submission(uuid, text, integer, text)')
    AS approve_fn,
  to_regprocedure('public.reject_deed_submission(uuid, text, text)')
    AS reject_fn,
  (
    SELECT conname
    FROM pg_constraint
    WHERE conname = 'deeds_completions_within_cap'
  ) AS completions_cap_constraint;

-- If approve_fn / reject_fn are NULL, STOP and apply migration 13 first.
-- Do not continue to privilege checks until those resolve.

-- ---------------------------------------------------------------------------
-- 1) RPC privileges (only after functions exist)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  approve_reg regprocedure :=
    to_regprocedure('public.approve_deed_submission(uuid, text, integer, text)');
  reject_reg regprocedure :=
    to_regprocedure('public.reject_deed_submission(uuid, text, text)');
BEGIN
  IF approve_reg IS NULL OR reject_reg IS NULL THEN
    RAISE EXCEPTION
      'Migration 13 not applied: approve_deed_submission / reject_deed_submission missing. Run 20260723120000_13_stage6_deed_moderation_rpc.sql first.';
  END IF;
END
$$;

SELECT
  has_function_privilege('anon', to_regprocedure('public.approve_deed_submission(uuid, text, integer, text)'), 'EXECUTE')
    AS anon_can_approve,
  has_function_privilege('authenticated', to_regprocedure('public.approve_deed_submission(uuid, text, integer, text)'), 'EXECUTE')
    AS authenticated_can_approve,
  has_function_privilege('service_role', to_regprocedure('public.approve_deed_submission(uuid, text, integer, text)'), 'EXECUTE')
    AS service_role_can_approve;

-- Expect: anon/authenticated = false, service_role = true

-- ---------------------------------------------------------------------------
-- Preconditions for functional tests (create fixtures as needed):
--   * one profile (submitter)
--   * one admin actor id text e.g. profile:<admin-uuid>
--   * deeds / pending submissions for fixed / range / none / capped cases
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- FIXED APPROVAL (replace :submission_id / :actor_id)
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.approve_deed_submission(
--   :submission_id::uuid,
--   :actor_id,
--   NULL,
--   'looks good'
-- );
--
-- Expect:
--   finalized = true
--   status = approved
--   leaf_awarded = fixed amount
--   leaf_ledger_id NOT NULL
--
-- SELECT amount, lifetime_delta, source_type, source_id, secondary_source_id,
--        actor_type, idempotency_key
-- FROM public.leaf_ledger
-- WHERE idempotency_key = 'deed_submission:' || :submission_id::text || ':approval';
--
-- Expect amount = lifetime_delta, source_type = deed, actor_type = service
--
-- Replay:
-- SELECT * FROM public.approve_deed_submission(:submission_id::uuid, :actor_id, NULL, NULL);
-- Expect finalized = false, same leaf_ledger_id, counters unchanged, no second audit.

-- ---------------------------------------------------------------------------
-- RANGE
-- ---------------------------------------------------------------------------
-- Valid min/max/midpoint; invalid below/above should raise FENN_INVALID_REWARD.

-- ---------------------------------------------------------------------------
-- NONE
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.approve_deed_submission(:submission_id::uuid, :actor_id, NULL, NULL);
-- Expect leaf_ledger_id IS NULL, leaf_awarded = 0, counters +1, audit present.

-- ---------------------------------------------------------------------------
-- CAP
-- ---------------------------------------------------------------------------
-- Approve until completions_count = max_completions.
-- Next distinct pending submission approval must raise FENN_COMPLETION_CAP_REACHED
-- and must NOT create a leaf_ledger row for that submission's idempotency key.

-- ---------------------------------------------------------------------------
-- REJECTION
-- ---------------------------------------------------------------------------
-- SELECT * FROM public.reject_deed_submission(:submission_id::uuid, :actor_id, 'needs clearer proof');
-- Expect status rejected, no LEAF, counters unchanged.
-- Empty note must raise FENN_INVALID_REVIEW_NOTE.
-- Approved submission reject must raise FENN_SUBMISSION_ALREADY_REVIEWED.

-- ---------------------------------------------------------------------------
-- Orphan-ledger edge (should not exist after migration for new approvals):
-- pending submission + existing deed_submission:<id>:approval ledger + deed at cap
-- → FENN_COMPLETION_CAP_REACHED; LEAF remains; requires manual ops reconciliation.
-- ---------------------------------------------------------------------------
