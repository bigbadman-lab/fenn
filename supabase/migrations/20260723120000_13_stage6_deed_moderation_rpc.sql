-- FENN Stage 6.4 — Additive: transactional Deed moderation RPCs
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Does not modify prior migration files.
--
-- Purpose: make capped Deed approval safe under concurrency by coordinating
-- submission terminal transition + LEAF ledger + counters + audit in ONE
-- Postgres transaction. Preserves Stage 4 leaf_ledger semantics (append-only,
-- profile cache via existing trigger, canonical idempotency key).
--
-- Trusted server/service-role path only. Does NOT authenticate admins.
-- Caller (Next.js) must call requireFennAdmin() before invoking.

-- ---------------------------------------------------------------------------
-- Defense-in-depth: completions cannot exceed max_completions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.deeds d
    WHERE d.max_completions IS NOT NULL
      AND d.completions_count > d.max_completions
  ) THEN
    RAISE EXCEPTION
      'FENN_MIGRATION: cannot add deeds_completions_within_cap — existing rows violate completions_count <= max_completions';
  END IF;
END
$$;

ALTER TABLE public.deeds
  ADD CONSTRAINT deeds_completions_within_cap
  CHECK (
    max_completions IS NULL
    OR completions_count <= max_completions
  );

COMMENT ON CONSTRAINT deeds_completions_within_cap ON public.deeds IS
  'Defense-in-depth: completions_count must never exceed max_completions when set.';

-- ---------------------------------------------------------------------------
-- public.approve_deed_submission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_deed_submission(
  p_submission_id uuid,
  p_actor_id text,
  p_leaf_amount integer DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS TABLE (
  finalized boolean,
  submission_id uuid,
  deed_id uuid,
  profile_id uuid,
  status text,
  leaf_awarded integer,
  leaf_ledger_id uuid,
  deed_completions_count integer,
  profile_deeds_completed_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_note text;
  v_submission public.deed_submissions%ROWTYPE;
  v_deed public.deeds%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_key text;
  v_reward_kind text;
  v_resolved_amount integer;
  v_existing_ledger public.leaf_ledger%ROWTYPE;
  v_ledger public.leaf_ledger%ROWTYPE;
  v_reason text;
  v_metadata jsonb;
  v_has_ledger boolean := false;
  v_existing_ledger_found boolean := false;
BEGIN
  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: submission_id required'
      USING ERRCODE = '22023';
  END IF;

  v_actor := trim(COALESCE(p_actor_id, ''));
  IF length(v_actor) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: actor_id required'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(trim(COALESCE(p_review_note, '')), '');

  -- Serialize concurrent approvals for the same submission.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 6));

  SELECT *
  INTO v_submission
  FROM public.deed_submissions s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_NOT_FOUND: submission missing'
      USING ERRCODE = 'P0002';
  END IF;

  -- Already approved: idempotent replay — no counter/audit/economic mutation.
  IF v_submission.status = 'approved' THEN
    finalized := false;
    submission_id := v_submission.id;
    deed_id := v_submission.deed_id;
    profile_id := v_submission.profile_id;
    status := v_submission.status;
    leaf_awarded := v_submission.leaf_awarded;
    leaf_ledger_id := v_submission.leaf_ledger_id;

    SELECT d.completions_count, p.deeds_completed_count
    INTO deed_completions_count, profile_deeds_completed_count
    FROM public.deeds d
    JOIN public.profiles p ON p.id = v_submission.profile_id
    WHERE d.id = v_submission.deed_id;

    RETURN NEXT;
    RETURN;
  END IF;

  IF v_submission.status = 'rejected' THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: submission is rejected'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_submission.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: submission not pending'
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock Deed before any LEAF insert (cap enforcement).
  SELECT *
  INTO v_deed
  FROM public.deeds d
  WHERE d.id = v_submission.deed_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_VALIDATION: deed missing for submission'
      USING ERRCODE = '22023';
  END IF;

  -- Parse reward shape (Stage 6.1 semantics). Fail closed on malformed.
  IF v_deed.reward_leaf_fixed IS NOT NULL
     AND v_deed.reward_leaf_min IS NULL
     AND v_deed.reward_leaf_max IS NULL
     AND v_deed.reward_leaf_fixed >= 0 THEN
    v_reward_kind := 'fixed';
  ELSIF v_deed.reward_leaf_fixed IS NULL
     AND v_deed.reward_leaf_min IS NOT NULL
     AND v_deed.reward_leaf_max IS NOT NULL
     AND v_deed.reward_leaf_min >= 0
     AND v_deed.reward_leaf_max >= v_deed.reward_leaf_min THEN
    v_reward_kind := 'range';
  ELSIF v_deed.reward_leaf_fixed IS NULL
     AND v_deed.reward_leaf_min IS NULL
     AND v_deed.reward_leaf_max IS NULL THEN
    v_reward_kind := 'none';
  ELSE
    RAISE EXCEPTION 'FENN_INVALID_DEED_REWARD_CONFIG: malformed reward columns'
      USING ERRCODE = '22023';
  END IF;

  IF v_reward_kind = 'fixed' THEN
    -- Prefer deriving fixed amount from DB; reject mismatched caller amount.
    IF p_leaf_amount IS NOT NULL AND p_leaf_amount IS DISTINCT FROM v_deed.reward_leaf_fixed THEN
      RAISE EXCEPTION 'FENN_INVALID_REWARD: fixed amount must equal deed reward'
        USING ERRCODE = '22023';
    END IF;
    v_resolved_amount := v_deed.reward_leaf_fixed;
  ELSIF v_reward_kind = 'range' THEN
    IF p_leaf_amount IS NULL THEN
      RAISE EXCEPTION 'FENN_INVALID_REWARD: range reward requires leaf amount'
        USING ERRCODE = '22023';
    END IF;
    IF p_leaf_amount < v_deed.reward_leaf_min OR p_leaf_amount > v_deed.reward_leaf_max THEN
      RAISE EXCEPTION 'FENN_INVALID_REWARD: amount outside deed range'
        USING ERRCODE = '22023';
    END IF;
    v_resolved_amount := p_leaf_amount;
  ELSE
    -- none
    IF p_leaf_amount IS NOT NULL AND p_leaf_amount <> 0 THEN
      RAISE EXCEPTION 'FENN_INVALID_REWARD: no-leaf deed cannot award LEAF'
        USING ERRCODE = '22023';
    END IF;
    v_resolved_amount := 0;
  END IF;

  -- Cap check while Deed row is locked. Must run BEFORE any new LEAF insert.
  -- Lookup existing canonical ledger first so we can distinguish true cap
  -- denials from rare legacy orphan-ledger + at-cap states.
  v_key := 'deed_submission:' || v_submission.id::text || ':approval';

  IF v_resolved_amount > 0 THEN
    SELECT *
    INTO v_existing_ledger
    FROM public.leaf_ledger l
    WHERE l.idempotency_key = v_key
    FOR UPDATE;

    v_existing_ledger_found := FOUND;
  END IF;

  IF v_deed.max_completions IS NOT NULL
     AND v_deed.completions_count >= v_deed.max_completions THEN
    IF v_existing_ledger_found THEN
      RAISE EXCEPTION
        'FENN_COMPLETION_CAP_REACHED: deed has no remaining completions (existing_ledger=true; manual reconciliation required)'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'FENN_COMPLETION_CAP_REACHED: deed has no remaining completions'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_submission.profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  -- Rewarding Deed: amount > 0 requires a ledger row (amount <> 0 constraint).
  IF v_resolved_amount > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 2));

    IF v_existing_ledger_found THEN
      -- Interrupted recovery: pending submission + existing canonical ledger.
      IF v_existing_ledger.profile_id IS DISTINCT FROM v_submission.profile_id THEN
        RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger profile mismatch'
          USING ERRCODE = '23505';
      END IF;
      IF v_existing_ledger.source_type IS DISTINCT FROM 'deed' THEN
        RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger source_type mismatch'
          USING ERRCODE = '22023';
      END IF;
      IF v_existing_ledger.source_id IS DISTINCT FROM v_submission.id::text THEN
        RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger source_id mismatch'
          USING ERRCODE = '22023';
      END IF;
      IF v_existing_ledger.secondary_source_id IS DISTINCT FROM v_deed.id::text THEN
        RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: ledger secondary_source_id mismatch'
          USING ERRCODE = '22023';
      END IF;
      IF v_existing_ledger.amount <= 0 THEN
        RAISE EXCEPTION 'FENN_LEDGER_CONFLICT: existing ledger amount invalid'
          USING ERRCODE = '22023';
      END IF;

      -- Existing ledger amount wins over newly requested range amount.
      v_ledger := v_existing_ledger;
      v_resolved_amount := v_existing_ledger.amount::integer;
      v_has_ledger := true;
    ELSE
      v_reason := 'Deed approved: ' || left(v_deed.title, 480);
      v_metadata := jsonb_build_object(
        'deedId', v_deed.id,
        'deedSlug', v_deed.slug,
        'submissionId', v_submission.id
      );

      INSERT INTO public.leaf_ledger (
        profile_id,
        wallet_address,
        amount,
        lifetime_delta,
        source_type,
        source_id,
        secondary_source_id,
        reason,
        actor_type,
        actor_id,
        idempotency_key,
        metadata
      )
      VALUES (
        v_submission.profile_id,
        v_profile.wallet_address,
        v_resolved_amount,
        v_resolved_amount, -- Stage 4 award: lifetime_delta = amount
        'deed',
        v_submission.id::text,
        v_deed.id::text,
        v_reason,
        'service',
        v_actor,
        v_key,
        v_metadata
      )
      RETURNING * INTO v_ledger;

      v_has_ledger := true;
    END IF;
  END IF;

  -- Transition pending → approved (conditional on still pending).
  UPDATE public.deed_submissions s
  SET
    status = 'approved',
    reviewed_at = timezone('utc', now()),
    reviewed_by_actor_id = v_actor,
    review_note = v_note,
    leaf_awarded = CASE WHEN v_has_ledger THEN v_resolved_amount ELSE 0 END,
    leaf_ledger_id = CASE WHEN v_has_ledger THEN v_ledger.id ELSE NULL END,
    updated_at = timezone('utc', now())
  WHERE s.id = v_submission.id
    AND s.status = 'pending'
  RETURNING * INTO v_submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: lost pending race'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.deeds d
  SET
    completions_count = completions_count + 1,
    updated_at = timezone('utc', now())
  WHERE d.id = v_deed.id
    AND (
      d.max_completions IS NULL
      OR d.completions_count < d.max_completions
    )
  RETURNING * INTO v_deed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_COMPLETION_CAP_REACHED: deed has no remaining completions'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles p
  SET
    deeds_completed_count = deeds_completed_count + 1,
    updated_at = timezone('utc', now())
  WHERE p.id = v_profile.id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: profile missing during counter update'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    reason
  )
  VALUES (
    v_actor,
    'admin',
    'deed.submission.approve',
    'deed_submission',
    v_submission.id::text,
    jsonb_build_object(
      'status', 'pending',
      'deed_id', v_deed.id,
      'profile_id', v_profile.id
    ),
    jsonb_build_object(
      'status', 'approved',
      'deed_id', v_deed.id,
      'profile_id', v_profile.id,
      'leaf_awarded', v_submission.leaf_awarded,
      'leaf_ledger_id', v_submission.leaf_ledger_id,
      'deed_completions_count', v_deed.completions_count,
      'profile_deeds_completed_count', v_profile.deeds_completed_count,
      'idempotency_key', v_key
    ),
    COALESCE(v_note, 'Deed submission approved')
  );

  finalized := true;
  submission_id := v_submission.id;
  deed_id := v_submission.deed_id;
  profile_id := v_submission.profile_id;
  status := v_submission.status;
  leaf_awarded := v_submission.leaf_awarded;
  leaf_ledger_id := v_submission.leaf_ledger_id;
  deed_completions_count := v_deed.completions_count;
  profile_deeds_completed_count := v_profile.deeds_completed_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.approve_deed_submission(uuid, text, integer, text) IS
  'Atomic Deed approval: cap check, Stage 4-equivalent leaf_ledger insert, pending→approved, counters, audit. service_role only. Idempotent on already-approved.';

REVOKE ALL ON FUNCTION public.approve_deed_submission(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_deed_submission(uuid, text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_deed_submission(uuid, text, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- public.reject_deed_submission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_deed_submission(
  p_submission_id uuid,
  p_actor_id text,
  p_review_note text
)
RETURNS TABLE (
  finalized boolean,
  submission_id uuid,
  deed_id uuid,
  profile_id uuid,
  status text,
  review_note text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_note text;
  v_submission public.deed_submissions%ROWTYPE;
BEGIN
  IF p_submission_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: submission_id required'
      USING ERRCODE = '22023';
  END IF;

  v_actor := trim(COALESCE(p_actor_id, ''));
  IF length(v_actor) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: actor_id required'
      USING ERRCODE = '22023';
  END IF;

  v_note := trim(COALESCE(p_review_note, ''));
  IF length(v_note) = 0 THEN
    RAISE EXCEPTION 'FENN_INVALID_REVIEW_NOTE: review note required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 7));

  SELECT *
  INTO v_submission
  FROM public.deed_submissions s
  WHERE s.id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_NOT_FOUND: submission missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_submission.status = 'rejected' THEN
    finalized := false;
    submission_id := v_submission.id;
    deed_id := v_submission.deed_id;
    profile_id := v_submission.profile_id;
    status := v_submission.status;
    review_note := v_submission.review_note;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_submission.status = 'approved' THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: submission is approved'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_submission.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: submission not pending'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.deed_submissions s
  SET
    status = 'rejected',
    reviewed_at = timezone('utc', now()),
    reviewed_by_actor_id = v_actor,
    review_note = v_note,
    updated_at = timezone('utc', now())
  WHERE s.id = v_submission.id
    AND s.status = 'pending'
  RETURNING * INTO v_submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_SUBMISSION_ALREADY_REVIEWED: lost pending race'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    reason
  )
  VALUES (
    v_actor,
    'admin',
    'deed.submission.reject',
    'deed_submission',
    v_submission.id::text,
    jsonb_build_object(
      'status', 'pending',
      'deed_id', v_submission.deed_id,
      'profile_id', v_submission.profile_id
    ),
    jsonb_build_object(
      'status', 'rejected',
      'deed_id', v_submission.deed_id,
      'profile_id', v_submission.profile_id,
      'review_note', v_note
    ),
    v_note
  );

  finalized := true;
  submission_id := v_submission.id;
  deed_id := v_submission.deed_id;
  profile_id := v_submission.profile_id;
  status := v_submission.status;
  review_note := v_submission.review_note;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.reject_deed_submission(uuid, text, text) IS
  'Atomic Deed rejection: pending→rejected + audit. No LEAF. No counters. service_role only.';

REVOKE ALL ON FUNCTION public.reject_deed_submission(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_deed_submission(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_deed_submission(uuid, text, text) TO service_role;
