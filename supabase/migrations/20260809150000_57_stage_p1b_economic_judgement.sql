-- Stage P1B — final_economic_intent on judgements
-- LOCAL ONLY — apply when authorised.
-- Persists model-proposed economic intention (type/reason only).
-- Never stores private keys, amounts, tokens, or recipient addresses from model
-- (recipient wallet is resolved at authority time from trusted application state).

ALTER TABLE public.x_perception_judgements
  ADD COLUMN IF NOT EXISTS final_economic_intent jsonb;

COMMENT ON COLUMN public.x_perception_judgements.final_economic_intent IS
  'Stage P1B: model economic intention {type:NONE|transfer_fenn|burn_fenn, reason?, recipientSource?}. Never keys/amounts/token/chain.';

-- Policy codes for P1B (model-proposed path)
ALTER TABLE public.x_perception_authorizations
  DROP CONSTRAINT IF EXISTS x_perception_authorizations_policy_code_check;

ALTER TABLE public.x_perception_authorizations
  ADD CONSTRAINT x_perception_authorizations_policy_code_check
  CHECK (policy_code IN (
    'permitted_reply',
    'permitted_wall',
    'permitted_reply_and_wall',
    'permitted_transfer_p1a',
    'permitted_burn_p1a',
    'permitted_transfer_p1b',
    'permitted_burn_p1b',
    'permitted_reply_and_economic',
    'no_action',
    'invalid_final_judgement',
    'missing_reply_candidate',
    'missing_wall_candidate',
    'invalid_candidate',
    'event_not_eligible',
    'already_authorised',
    'judgement_failed',
    'wall_requires_reply',
    'reply_generation_failed'
  ));

-- Extend finalize with final_economic_intent
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
  p_final_prompt_version text,
  p_final_wall_candidate jsonb DEFAULT NULL,
  p_final_economic_intent jsonb DEFAULT NULL
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

  IF v_existing_final_status <> 'pending' THEN
    created := false;
    RETURN NEXT;
    RETURN;
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
    final_prompt_version = CASE WHEN p_final_status = 'finalized' THEN trim(p_final_prompt_version) ELSE NULL END,
    final_wall_candidate = CASE
      WHEN p_final_status = 'finalized' THEN p_final_wall_candidate
      ELSE NULL
    END,
    final_economic_intent = CASE
      WHEN p_final_status = 'finalized' THEN COALESCE(p_final_economic_intent, '{"type":"NONE"}'::jsonb)
      ELSE NULL
    END
  WHERE perception_event_id = p_perception_event_id;

  created := true;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb, jsonb
) IS
  'Finalize Stage 12.4 judgement with live-state, optional Wall candidate, and economic intent.';

REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb, jsonb
) TO service_role;

-- Drop prior 14-arg signature (wall only).
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.finalize_x_perception_judgement_with_live_state(
    uuid, text, boolean, text[], text[],
    text, text, boolean, text, text, boolean, text, text, jsonb
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

-- Claim returns final_economic_intent
DROP FUNCTION IF EXISTS public.claim_x_perception_for_authority();

CREATE FUNCTION public.claim_x_perception_for_authority()
RETURNS TABLE (
  perception_event_id uuid,
  judgement_id uuid,
  x_post_id text,
  perception_type text,
  author_x_user_id text,
  body text,
  final_status text,
  final_action text,
  final_reason_code text,
  final_engage boolean,
  final_reply_text text,
  final_wall_body text,
  final_identity_unverified boolean,
  needs_live_state text[],
  live_state_available boolean,
  already_authorised boolean,
  final_wall_candidate jsonb,
  final_economic_intent jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_judgement_id uuid;
  v_auth_exists boolean;
BEGIN
  SELECT j.perception_event_id, j.id
  INTO v_event_id, v_judgement_id
  FROM public.x_perception_judgements j
  WHERE j.final_status = 'finalized'
    AND NOT EXISTS (
      SELECT 1
      FROM public.x_perception_authorizations a
      WHERE a.perception_event_id = j.perception_event_id
    )
  ORDER BY j.finalized_at ASC NULLS LAST, j.created_at ASC
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.x_perception_authorizations a
    WHERE a.perception_event_id = v_event_id
  ) INTO v_auth_exists;

  RETURN QUERY
  SELECT
    e.id,
    j.id,
    e.x_post_id,
    e.perception_type,
    e.author_x_user_id,
    e.body,
    j.final_status,
    j.final_action,
    j.final_reason_code,
    j.final_engage,
    j.final_reply_text,
    j.final_wall_body,
    j.final_identity_unverified,
    j.needs_live_state,
    j.live_state_available,
    v_auth_exists AS already_authorised,
    j.final_wall_candidate,
    j.final_economic_intent
  FROM public.x_perception_events e
  JOIN public.x_perception_judgements j
    ON j.perception_event_id = e.id
  WHERE e.id = v_event_id
    AND j.id = v_judgement_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_for_authority() IS
  'Claim one finalized judgement for Stage 12.5 authority (includes Wall candidate + economic intent).';

REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_for_authority() TO service_role;
