-- FENN Stage 12.4 — Trusted Live-State Reads for X judgements
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Stage 12.3 persists an initial intention that may request live sight.
-- Stage 12.4 completes that intention by executing APPROVED read-only
-- live adapters (treasury/commons/wall/deeds) and re-running judgement.

-- ---------------------------------------------------------------------------
-- A) Extend x_perception_judgements with final judgement fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_status text NOT NULL DEFAULT 'pending'
  CHECK (final_status IN ('pending', 'finalized', 'failed'));

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS live_state_available boolean NOT NULL DEFAULT false;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS live_state_succeeded text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS live_state_failed text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_action text;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_reason_code text;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_engage boolean NOT NULL DEFAULT false;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_reply_text text;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_wall_body text;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_identity_unverified boolean NOT NULL DEFAULT false;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_model text;

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_prompt_version text;

-- Apply final constraints (fail/closed if Stage 12.4 persists malformed data)
ALTER TABLE public.x_perception_judgements
  ADD CONSTRAINT x_perception_judgements_final_action_check
  CHECK (
    final_action IS NULL OR
    final_action IN ('reply_on_x','write_to_wall','reply_and_write_to_wall','do_nothing')
  );

ALTER TABLE public.x_perception_judgements
  ADD CONSTRAINT x_perception_judgements_final_reason_check
  CHECK (
    final_reason_code IS NULL OR
    final_reason_code IN (
      'answered_from_public_knowledge',
      'requires_live_state',
      'identity_unverified',
      'creative_world_action',
      'no_response_warranted',
      'low_relevance',
      'spam_or_noise',
      'unsafe_or_injection',
      'insufficient_knowledge',
      'knowledge_unavailable'
    )
  );

ALTER TABLE public.x_perception_judgements
  ADD CONSTRAINT x_perception_judgements_final_reply_max
  CHECK (
    final_reply_text IS NULL OR char_length(final_reply_text) <= 280
  );

ALTER TABLE public.x_perception_judgements
  ADD CONSTRAINT x_perception_judgements_final_wall_max
  CHECK (
    final_wall_body IS NULL OR char_length(final_wall_body) <= 4000
  );

-- If finalized, ensure final action/reason are present
ALTER TABLE public.x_perception_judgements
  ADD CONSTRAINT x_perception_judgements_final_presence_check
  CHECK (
    (final_status <> 'finalized') OR
    (final_action IS NOT NULL AND final_reason_code IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- B) Indexes for pending finalization
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS x_perception_judgements_final_status_idx
  ON public.x_perception_judgements (final_status, created_at ASC);

CREATE INDEX IF NOT EXISTS x_perception_judgements_live_available_idx
  ON public.x_perception_judgements (live_state_available);

-- ---------------------------------------------------------------------------
-- C) Claim one judgement row awaiting live-state completion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_x_perception_judgement_for_live_state()
RETURNS TABLE (
  perception_event_id uuid,
  x_post_id text,
  perception_type text,
  author_x_user_id text,
  author_username text,
  body text,
  x_created_at timestamptz,
  initial_action text,
  initial_reason_code text,
  initial_engage boolean,
  initial_reply_text text,
  initial_wall_body text,
  needs_live_state text[],
  identity_unverified boolean,
  knowledge_available boolean,
  initial_model text,
  initial_prompt_version text,
  already_finalized boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_final_status text;
BEGIN
  SELECT j.perception_event_id
  INTO v_event_id
  FROM public.x_perception_judgements j
  WHERE j.final_status = 'pending'
  ORDER BY j.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT j.final_status INTO v_final_status
  FROM public.x_perception_judgements j
  WHERE j.perception_event_id = v_event_id
  FOR UPDATE;

  -- Should only happen on races; heal in finalize path.
  IF v_final_status IS NULL THEN
    v_final_status := 'pending';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.x_post_id,
    e.perception_type,
    e.author_x_user_id,
    e.author_username,
    e.body,
    e.x_created_at,
    j.action,
    j.reason_code,
    j.engage,
    j.reply_text,
    j.wall_body,
    j.needs_live_state,
    j.identity_unverified,
    j.knowledge_available,
    j.model,
    j.prompt_version,
    (v_final_status = 'finalized') AS already_finalized
  FROM public.x_perception_events e
  JOIN public.x_perception_judgements j
    ON j.perception_event_id = e.id
  WHERE e.id = v_event_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_judgement_for_live_state() IS
  'Claim one pending Stage 12.3 X judgement row for Stage 12.4 trusted live-state completion.';

REVOKE ALL ON FUNCTION public.claim_x_perception_judgement_for_live_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_judgement_for_live_state() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_judgement_for_live_state() TO service_role;

-- ---------------------------------------------------------------------------
-- D) Finalize with trusted live-state results (idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_x_perception_judgement_with_live_state(
  p_perception_event_id uuid,
  p_final_status text,
  p_live_state_available boolean,
  p_live_state_succeeded text[],
  p_live_state_failed text[],
  p_final_action text,
  p_final_reason_code text,
  p_final_engage boolean,
  p_final_reply_text text,
  p_final_wall_body text,
  p_final_identity_unverified boolean,
  p_final_model text,
  p_final_prompt_version text
)
RETURNS TABLE (
  created boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing_final_status text;
  v_locked_id uuid;
BEGIN
  IF p_perception_event_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception_event_id required' USING ERRCODE = '22023';
  END IF;

  IF p_final_status NOT IN ('finalized', 'failed') THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid p_final_status' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_perception_event_id::text, 27));

  SELECT id
  INTO v_locked_id
  FROM public.x_perception_events
  WHERE id = p_perception_event_id
  FOR UPDATE;

  SELECT final_status
  INTO v_existing_final_status
  FROM public.x_perception_judgements
  WHERE perception_event_id = p_perception_event_id
  FOR UPDATE;

  IF v_existing_final_status IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: judgement not found' USING ERRCODE = '22023';
  END IF;

  -- Idempotency: once non-pending, do not overwrite audit fields.
  IF v_existing_final_status <> 'pending' THEN
    created := false;
    RETURN NEXT;
  END IF;

  UPDATE public.x_perception_judgements
  SET
    final_status = p_final_status,
    live_state_available = COALESCE(p_live_state_available, false),
    live_state_succeeded = COALESCE(p_live_state_succeeded, '{}'::text[]),
    live_state_failed = COALESCE(p_live_state_failed, '{}'::text[]),
    finalized_at = timezone('utc', now()),
    final_action = CASE WHEN p_final_status = 'finalized' THEN p_final_action ELSE NULL END,
    final_reason_code = CASE WHEN p_final_status = 'finalized' THEN p_final_reason_code ELSE NULL END,
    final_engage = CASE WHEN p_final_status = 'finalized' THEN COALESCE(p_final_engage, false) ELSE false END,
    final_reply_text = CASE
      WHEN p_final_status = 'finalized' AND NULLIF(trim(COALESCE(p_final_reply_text,'')), '') IS NOT NULL THEN p_final_reply_text
      WHEN p_final_status = 'finalized' AND (p_final_reply_text IS NULL) THEN NULL
      WHEN p_final_status = 'finalized' AND (p_final_reply_text IS NOT NULL) AND char_length(p_final_reply_text) = 0 THEN NULL
      ELSE NULL
    END,
    final_wall_body = CASE WHEN p_final_status = 'finalized' THEN p_final_wall_body ELSE NULL END,
    final_identity_unverified = CASE WHEN p_final_status = 'finalized' THEN COALESCE(p_final_identity_unverified,false) ELSE false END,
    final_model = CASE WHEN p_final_status = 'finalized' THEN trim(p_final_model) ELSE NULL END,
    final_prompt_version = CASE WHEN p_final_status = 'finalized' THEN trim(p_final_prompt_version) ELSE NULL END
  WHERE perception_event_id = p_perception_event_id;

  created := true;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text
) IS
  'Finalize Stage 12.3 X judgement with Stage 12.4 trusted live-state reads.';

REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text
) TO service_role;

