-- FENN Stage 11.3 — Autonomous memory candidate resolution
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Does not redesign memory_candidates or add embeddings.
--
-- Auto-approval may only create:
--   layer = greenwood_memory
--   visibility = camp
-- Never canon. Never public.

-- ---------------------------------------------------------------------------
-- One approved memory per source candidate
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS fenn_memories_source_candidate_uidx
  ON public.fenn_memories (source_candidate_id)
  WHERE source_candidate_id IS NOT NULL;

COMMENT ON INDEX public.fenn_memories_source_candidate_uidx IS
  'At most one fenn_memories row per memory_candidates source.';

-- ---------------------------------------------------------------------------
-- public.resolve_memory_candidate_approve
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_memory_candidate_approve(
  p_candidate_id uuid,
  p_actor_id text,
  p_title text,
  p_content text,
  p_reason_code text,
  p_review_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  finalized boolean,
  candidate_id uuid,
  status text,
  resulting_memory_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_title text;
  v_content text;
  v_reason text;
  v_meta jsonb;
  v_candidate public.memory_candidates%ROWTYPE;
  v_memory_id uuid;
  v_source_message_id uuid;
BEGIN
  IF p_candidate_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: candidate_id required'
      USING ERRCODE = '22023';
  END IF;

  v_actor := trim(COALESCE(p_actor_id, ''));
  IF length(v_actor) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: actor_id required'
      USING ERRCODE = '22023';
  END IF;

  v_title := trim(COALESCE(p_title, ''));
  IF length(v_title) = 0 OR char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: title invalid'
      USING ERRCODE = '22023';
  END IF;

  v_content := COALESCE(p_content, '');
  IF length(trim(v_content)) = 0 OR char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: content invalid'
      USING ERRCODE = '22023';
  END IF;

  v_reason := trim(COALESCE(p_reason_code, ''));
  IF length(v_reason) = 0 OR char_length(v_reason) > 64 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: reason_code invalid'
      USING ERRCODE = '22023';
  END IF;

  v_meta := COALESCE(p_review_metadata, '{}'::jsonb);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_candidate_id::text, 11));

  SELECT *
  INTO v_candidate
  FROM public.memory_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_NOT_FOUND: memory candidate not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_candidate.status = 'approved' THEN
    IF v_candidate.resulting_memory_id IS NULL THEN
      RAISE EXCEPTION 'FENN_STATE: approved candidate missing memory'
        USING ERRCODE = 'P0001';
    END IF;
    finalized := false;
    candidate_id := v_candidate.id;
    status := v_candidate.status;
    resulting_memory_id := v_candidate.resulting_memory_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_candidate.status = 'discarded' THEN
    RAISE EXCEPTION 'FENN_STATE: discarded candidate cannot approve'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_candidate.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FENN_STATE: candidate not pending'
      USING ERRCODE = 'P0001';
  END IF;

  v_source_message_id := v_candidate.camp_message_id;

  INSERT INTO public.fenn_memories (
    layer,
    title,
    content,
    visibility,
    is_active,
    source_candidate_id,
    source_message_id,
    source_profile_id,
    approved_at,
    approved_by_actor_id,
    metadata
  )
  VALUES (
    'greenwood_memory',
    v_title,
    v_content,
    'camp',
    true,
    v_candidate.id,
    v_source_message_id,
    v_candidate.profile_id,
    timezone('utc', now()),
    v_actor,
    jsonb_build_object(
      'auto_reviewed', true,
      'reason_code', v_reason
    ) || v_meta
  )
  RETURNING id INTO v_memory_id;

  UPDATE public.memory_candidates
  SET
    status = 'approved',
    reviewed_at = timezone('utc', now()),
    reviewed_by_actor_id = v_actor,
    resulting_memory_id = v_memory_id
  WHERE id = v_candidate.id;

  INSERT INTO public.admin_audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    after_state,
    reason
  )
  VALUES (
    v_actor,
    'system',
    'memory_candidate.auto_approved',
    'memory_candidate',
    v_candidate.id::text,
    jsonb_build_object(
      'memory_id', v_memory_id,
      'reason_code', v_reason
    ),
    v_reason
  );

  finalized := true;
  candidate_id := v_candidate.id;
  status := 'approved';
  resulting_memory_id := v_memory_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb) IS
  'Atomic auto-approve: insert greenwood_memory(visibility=camp) + pending→approved + audit. service_role only. Idempotent when already approved.';

REVOKE ALL ON FUNCTION public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_memory_candidate_approve(uuid, text, text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- public.resolve_memory_candidate_discard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_memory_candidate_discard(
  p_candidate_id uuid,
  p_actor_id text,
  p_reason_code text,
  p_review_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  finalized boolean,
  candidate_id uuid,
  status text,
  resulting_memory_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor text;
  v_reason text;
  v_candidate public.memory_candidates%ROWTYPE;
BEGIN
  IF p_candidate_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: candidate_id required'
      USING ERRCODE = '22023';
  END IF;

  v_actor := trim(COALESCE(p_actor_id, ''));
  IF length(v_actor) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: actor_id required'
      USING ERRCODE = '22023';
  END IF;

  v_reason := trim(COALESCE(p_reason_code, ''));
  IF length(v_reason) = 0 OR char_length(v_reason) > 64 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: reason_code invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_candidate_id::text, 11));

  SELECT *
  INTO v_candidate
  FROM public.memory_candidates c
  WHERE c.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_NOT_FOUND: memory candidate not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_candidate.status = 'discarded' THEN
    finalized := false;
    candidate_id := v_candidate.id;
    status := v_candidate.status;
    resulting_memory_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_candidate.status = 'approved' THEN
    RAISE EXCEPTION 'FENN_STATE: approved candidate cannot discard'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_candidate.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FENN_STATE: candidate not pending'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.memory_candidates
  SET
    status = 'discarded',
    reviewed_at = timezone('utc', now()),
    reviewed_by_actor_id = v_actor,
    resulting_memory_id = NULL
  WHERE id = v_candidate.id;

  INSERT INTO public.admin_audit_log (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    after_state,
    reason
  )
  VALUES (
    v_actor,
    'system',
    'memory_candidate.auto_discarded',
    'memory_candidate',
    v_candidate.id::text,
    jsonb_build_object(
      'reason_code', v_reason,
      'review_meta', COALESCE(p_review_metadata, '{}'::jsonb)
    ),
    v_reason
  );

  finalized := true;
  candidate_id := v_candidate.id;
  status := 'discarded';
  resulting_memory_id := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.resolve_memory_candidate_discard(uuid, text, text, jsonb) IS
  'Atomic auto-discard: pending→discarded + audit. No memory row. service_role only. Idempotent when already discarded.';

REVOKE ALL ON FUNCTION public.resolve_memory_candidate_discard(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_memory_candidate_discard(uuid, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_memory_candidate_discard(uuid, text, text, jsonb) TO service_role;
