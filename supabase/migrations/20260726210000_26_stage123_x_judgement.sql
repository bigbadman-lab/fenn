-- FENN Stage 12.3 — X perception judgement / intention
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Forms intentions only — no X posts, Wall writes, memory, or live tools.
--
-- Separation:
--   x_perception_events  = what FENN heard (Stage 12.2)
--   x_perception_judgements = what FENN decided (Stage 12.3)
--
-- x_perception_events.status='processed' means judgement formed, NOT that an action executed.

-- ---------------------------------------------------------------------------
-- Clarify perception lifecycle semantics
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.x_perception_events.status IS
  'pending=awaiting judgement; processing=claimed; processed=judgement formed (not executed); failed=judgement failed (retryable by reset).';

-- ---------------------------------------------------------------------------
-- x_perception_judgements
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_perception_judgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perception_event_id uuid NOT NULL REFERENCES public.x_perception_events (id) ON DELETE CASCADE,
  action text NOT NULL,
  reason_code text NOT NULL,
  engage boolean NOT NULL,
  reply_text text,
  wall_body text,
  needs_live_state text[] NOT NULL DEFAULT '{}'::text[],
  identity_unverified boolean NOT NULL DEFAULT false,
  knowledge_available boolean NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_perception_judgements_action_check
    CHECK (action IN (
      'reply_on_x',
      'write_to_wall',
      'reply_and_write_to_wall',
      'do_nothing'
    )),
  CONSTRAINT x_perception_judgements_reason_check
    CHECK (reason_code IN (
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
    )),
  CONSTRAINT x_perception_judgements_reply_max
    CHECK (reply_text IS NULL OR char_length(reply_text) <= 280),
  CONSTRAINT x_perception_judgements_wall_max
    CHECK (wall_body IS NULL OR char_length(wall_body) <= 4000),
  CONSTRAINT x_perception_judgements_model_nonempty
    CHECK (length(trim(model)) > 0),
  CONSTRAINT x_perception_judgements_prompt_nonempty
    CHECK (length(trim(prompt_version)) > 0)
);

-- One final judgement per perception (MVP).
CREATE UNIQUE INDEX x_perception_judgements_perception_uidx
  ON public.x_perception_judgements (perception_event_id);

CREATE INDEX x_perception_judgements_action_created_idx
  ON public.x_perception_judgements (action, created_at DESC);

CREATE INDEX x_perception_judgements_reason_idx
  ON public.x_perception_judgements (reason_code);

COMMENT ON TABLE public.x_perception_judgements IS
  'Stage 12.3 FENN intentions. Not execution. No browser access. No chain-of-thought.';

COMMENT ON COLUMN public.x_perception_judgements.reply_text IS
  'Candidate X reply only. Not posted in Stage 12.3.';

COMMENT ON COLUMN public.x_perception_judgements.wall_body IS
  'Candidate Wall body (prose/ASCII). Whitespace preserved. Not written in Stage 12.3.';

COMMENT ON COLUMN public.x_perception_judgements.needs_live_state IS
  'Trusted live capabilities required before a future answer. Not executed here.';

-- ---------------------------------------------------------------------------
-- Browser lockdown
-- ---------------------------------------------------------------------------
ALTER TABLE public.x_perception_judgements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_perception_judgements FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim one pending perception for judgement (SKIP LOCKED)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_x_perception_for_judgement()
RETURNS TABLE (
  event_id uuid,
  x_post_id text,
  perception_type text,
  author_x_user_id text,
  author_username text,
  body text,
  x_created_at timestamptz,
  already_judged boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_existing uuid;
BEGIN
  SELECT e.id
  INTO v_id
  FROM public.x_perception_events e
  WHERE e.status = 'pending'
  ORDER BY e.received_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  SELECT j.id INTO v_existing
  FROM public.x_perception_judgements j
  WHERE j.perception_event_id = v_id;

  IF v_existing IS NOT NULL THEN
    -- Perception pending but judgement exists — heal to processed, skip work.
    UPDATE public.x_perception_events
    SET status = 'processed',
        processed_at = COALESCE(processed_at, timezone('utc', now())),
        last_error = NULL,
        updated_at = timezone('utc', now())
    WHERE id = v_id;

    RETURN QUERY
    SELECT
      e.id,
      e.x_post_id,
      e.perception_type,
      e.author_x_user_id,
      e.author_username,
      e.body,
      e.x_created_at,
      true
    FROM public.x_perception_events e
    WHERE e.id = v_id;
    RETURN;
  END IF;

  UPDATE public.x_perception_events
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      last_error = NULL,
      updated_at = timezone('utc', now())
  WHERE id = v_id;

  RETURN QUERY
  SELECT
    e.id,
    e.x_post_id,
    e.perception_type,
    e.author_x_user_id,
    e.author_username,
    e.body,
    e.x_created_at,
    false
  FROM public.x_perception_events e
  WHERE e.id = v_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_for_judgement() IS
  'Claim one pending X perception for Stage 12.3 judgement. service_role only.';

REVOKE ALL ON FUNCTION public.claim_x_perception_for_judgement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_for_judgement() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_for_judgement() TO service_role;

-- ---------------------------------------------------------------------------
-- Finalize judgement (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_x_perception_judgement(
  p_perception_event_id uuid,
  p_action text,
  p_reason_code text,
  p_engage boolean,
  p_reply_text text,
  p_wall_body text,
  p_needs_live_state text[],
  p_identity_unverified boolean,
  p_knowledge_available boolean,
  p_model text,
  p_prompt_version text
)
RETURNS TABLE (
  created boolean,
  judgement_id uuid,
  action text,
  reason_code text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_status text;
  v_id uuid;
  v_action text;
  v_reason text;
BEGIN
  IF p_perception_event_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception_event_id required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_perception_event_id::text, 26)
  );

  SELECT e.status INTO v_status
  FROM public.x_perception_events e
  WHERE e.id = p_perception_event_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception not found' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: existing final judgement wins.
  SELECT j.id, j.action, j.reason_code
  INTO v_id, v_action, v_reason
  FROM public.x_perception_judgements j
  WHERE j.perception_event_id = p_perception_event_id;

  IF v_id IS NOT NULL THEN
    UPDATE public.x_perception_events
    SET status = 'processed',
        processed_at = COALESCE(processed_at, timezone('utc', now())),
        last_error = NULL,
        updated_at = timezone('utc', now())
    WHERE id = p_perception_event_id
      AND status <> 'processed';

    created := false;
    judgement_id := v_id;
    action := v_action;
    reason_code := v_reason;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_status NOT IN ('processing', 'pending', 'failed') THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception not claimable for finalize (%)', v_status
      USING ERRCODE = '22023';
  END IF;

  IF p_action NOT IN (
    'reply_on_x', 'write_to_wall', 'reply_and_write_to_wall', 'do_nothing'
  ) THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid action' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.x_perception_judgements (
    perception_event_id,
    action,
    reason_code,
    engage,
    reply_text,
    wall_body,
    needs_live_state,
    identity_unverified,
    knowledge_available,
    model,
    prompt_version
  )
  VALUES (
    p_perception_event_id,
    p_action,
    p_reason_code,
    p_engage,
    NULLIF(p_reply_text, ''),
    -- Preserve Wall ASCII whitespace; only treat fully empty as null.
    CASE
      WHEN p_wall_body IS NULL THEN NULL
      WHEN length(p_wall_body) = 0 THEN NULL
      ELSE p_wall_body
    END,
    COALESCE(p_needs_live_state, '{}'::text[]),
    COALESCE(p_identity_unverified, false),
    COALESCE(p_knowledge_available, false),
    trim(p_model),
    trim(p_prompt_version)
  )
  RETURNING id, x_perception_judgements.action, x_perception_judgements.reason_code
  INTO v_id, v_action, v_reason;

  UPDATE public.x_perception_events
  SET status = 'processed',
      processed_at = timezone('utc', now()),
      last_error = NULL,
      updated_at = timezone('utc', now())
  WHERE id = p_perception_event_id;

  created := true;
  judgement_id := v_id;
  action := v_action;
  reason_code := v_reason;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finalize_x_perception_judgement(
  uuid, text, text, boolean, text, text, text[], boolean, boolean, text, text
) IS
  'Persist Stage 12.3 intention and mark perception processed. Idempotent. service_role only.';

REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement(
  uuid, text, text, boolean, text, text, text[], boolean, boolean, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement(
  uuid, text, text, boolean, text, text, text[], boolean, boolean, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_x_perception_judgement(
  uuid, text, text, boolean, text, text, text[], boolean, boolean, text, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- Fail judgement (no intention row)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_x_perception_judgement(
  p_perception_event_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_perception_event_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception_event_id required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_perception_event_id::text, 26)
  );

  SELECT e.status INTO v_status
  FROM public.x_perception_events e
  WHERE e.id = p_perception_event_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception not found' USING ERRCODE = '22023';
  END IF;

  -- Do not overwrite a completed judgement path.
  IF EXISTS (
    SELECT 1 FROM public.x_perception_judgements j
    WHERE j.perception_event_id = p_perception_event_id
  ) THEN
    UPDATE public.x_perception_events
    SET status = 'processed',
        processed_at = COALESCE(processed_at, timezone('utc', now())),
        last_error = NULL,
        updated_at = timezone('utc', now())
    WHERE id = p_perception_event_id;
    RETURN;
  END IF;

  UPDATE public.x_perception_events
  SET status = 'failed',
      last_error = left(COALESCE(NULLIF(trim(p_error), ''), 'judgement failed'), 2000),
      updated_at = timezone('utc', now())
  WHERE id = p_perception_event_id;
END;
$$;

COMMENT ON FUNCTION public.fail_x_perception_judgement(uuid, text) IS
  'Mark perception judgement failed without creating an intention. service_role only.';

REVOKE ALL ON FUNCTION public.fail_x_perception_judgement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_x_perception_judgement(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_perception_judgement(uuid, text) TO service_role;
