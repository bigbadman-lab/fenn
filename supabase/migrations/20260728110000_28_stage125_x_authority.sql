-- FENN Stage 12.5 — Authority / consequence policy
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Authorises final intentions into pending effects — no execution.
--
-- Separation:
--   x_perception_events          = what FENN heard
--   x_perception_judgements      = what FENN decided
--   x_perception_authorizations  = what application policy permitted
--   x_perception_effects         = pending/completed consequence units (12.6 executes)

-- ---------------------------------------------------------------------------
-- x_perception_authorizations
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_perception_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perception_event_id uuid NOT NULL REFERENCES public.x_perception_events (id) ON DELETE CASCADE,
  judgement_id uuid NOT NULL REFERENCES public.x_perception_judgements (id) ON DELETE CASCADE,
  outcome text NOT NULL,
  policy_code text NOT NULL,
  policy_version text NOT NULL,
  final_action text NOT NULL,
  source_x_post_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_perception_authorizations_outcome_check
    CHECK (outcome IN ('permitted', 'denied', 'no_action')),
  CONSTRAINT x_perception_authorizations_policy_code_check
    CHECK (policy_code IN (
      'permitted_reply',
      'permitted_wall',
      'permitted_reply_and_wall',
      'no_action',
      'invalid_final_judgement',
      'missing_reply_candidate',
      'missing_wall_candidate',
      'invalid_candidate',
      'event_not_eligible',
      'already_authorised',
      'judgement_failed'
    )),
  CONSTRAINT x_perception_authorizations_final_action_check
    CHECK (final_action IN (
      'reply_on_x',
      'write_to_wall',
      'reply_and_write_to_wall',
      'do_nothing',
      'unknown'
    )),
  CONSTRAINT x_perception_authorizations_source_nonempty
    CHECK (length(trim(source_x_post_id)) > 0),
  CONSTRAINT x_perception_authorizations_policy_version_nonempty
    CHECK (length(trim(policy_version)) > 0)
);

CREATE UNIQUE INDEX x_perception_authorizations_perception_uidx
  ON public.x_perception_authorizations (perception_event_id);

CREATE UNIQUE INDEX x_perception_authorizations_judgement_uidx
  ON public.x_perception_authorizations (judgement_id);

CREATE INDEX x_perception_authorizations_outcome_created_idx
  ON public.x_perception_authorizations (outcome, created_at DESC);

COMMENT ON TABLE public.x_perception_authorizations IS
  'Stage 12.5 deterministic authority results. Intention ≠ authority. No browser access.';

-- ---------------------------------------------------------------------------
-- x_perception_effects — independent consequence units for Stage 12.6
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_perception_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES public.x_perception_authorizations (id) ON DELETE CASCADE,
  perception_event_id uuid NOT NULL REFERENCES public.x_perception_events (id) ON DELETE CASCADE,
  effect_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_perception_effects_type_check
    CHECK (effect_type IN ('reply_on_x', 'write_to_wall')),
  CONSTRAINT x_perception_effects_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT x_perception_effects_attempt_nonneg
    CHECK (attempt_count >= 0),
  CONSTRAINT x_perception_effects_key_nonempty
    CHECK (length(trim(idempotency_key)) > 0)
);

CREATE UNIQUE INDEX x_perception_effects_idempotency_uidx
  ON public.x_perception_effects (idempotency_key);

CREATE INDEX x_perception_effects_status_created_idx
  ON public.x_perception_effects (status, created_at ASC);

CREATE INDEX x_perception_effects_auth_idx
  ON public.x_perception_effects (authorization_id);

CREATE INDEX x_perception_effects_perception_idx
  ON public.x_perception_effects (perception_event_id);

CREATE TRIGGER x_perception_effects_set_updated_at
  BEFORE UPDATE ON public.x_perception_effects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.x_perception_effects IS
  'Stage 12.5 pending authorised effects. Stage 12.6 executes. Never browser-accessible.';

COMMENT ON COLUMN public.x_perception_effects.payload IS
  'Execution-safe JSON only (reply text / wall body / app-owned ids). No secrets.';

-- ---------------------------------------------------------------------------
-- Browser lockdown
-- ---------------------------------------------------------------------------
ALTER TABLE public.x_perception_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_perception_effects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_perception_authorizations FROM anon, authenticated;
REVOKE ALL ON TABLE public.x_perception_effects FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim one finalized judgement awaiting authority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_x_perception_for_authority()
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
  already_authorised boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_judgement_id uuid;
  v_auth_id uuid;
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

  SELECT a.id INTO v_auth_id
  FROM public.x_perception_authorizations a
  WHERE a.perception_event_id = v_event_id;

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
    (v_auth_id IS NOT NULL) AS already_authorised
  FROM public.x_perception_events e
  JOIN public.x_perception_judgements j ON j.perception_event_id = e.id
  WHERE e.id = v_event_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_for_authority() IS
  'Claim one finalized Stage 12.4 judgement for Stage 12.5 authority. service_role only.';

REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_for_authority() TO service_role;

-- ---------------------------------------------------------------------------
-- Persist authority + pending effects (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_x_perception_authorization(
  p_perception_event_id uuid,
  p_judgement_id uuid,
  p_outcome text,
  p_policy_code text,
  p_policy_version text,
  p_final_action text,
  p_source_x_post_id text,
  p_effects jsonb
)
RETURNS TABLE (
  created boolean,
  authorization_id uuid,
  outcome text,
  policy_code text,
  effects_created integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing_id uuid;
  v_existing_outcome text;
  v_existing_policy text;
  v_auth_id uuid;
  v_effect jsonb;
  v_effects_created integer := 0;
  v_effect_type text;
  v_key text;
  v_payload jsonb;
BEGIN
  IF p_perception_event_id IS NULL OR p_judgement_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: perception/judgement required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_perception_event_id::text, 28)
  );

  SELECT a.id, a.outcome, a.policy_code
  INTO v_existing_id, v_existing_outcome, v_existing_policy
  FROM public.x_perception_authorizations a
  WHERE a.perception_event_id = p_perception_event_id
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_effects_created
    FROM public.x_perception_effects e
    WHERE e.authorization_id = v_existing_id;

    created := false;
    authorization_id := v_existing_id;
    outcome := v_existing_outcome;
    policy_code := v_existing_policy;
    effects_created := v_effects_created;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.x_perception_authorizations (
    perception_event_id,
    judgement_id,
    outcome,
    policy_code,
    policy_version,
    final_action,
    source_x_post_id
  )
  VALUES (
    p_perception_event_id,
    p_judgement_id,
    p_outcome,
    p_policy_code,
    trim(p_policy_version),
    p_final_action,
    trim(p_source_x_post_id)
  )
  RETURNING id INTO v_auth_id;

  IF p_effects IS NOT NULL AND jsonb_typeof(p_effects) = 'array' THEN
    FOR v_effect IN SELECT * FROM jsonb_array_elements(p_effects)
    LOOP
      v_effect_type := v_effect->>'type';
      v_key := trim(COALESCE(v_effect->>'idempotency_key', ''));
      v_payload := v_effect->'payload';

      IF v_effect_type IS NULL OR v_key = '' OR v_payload IS NULL THEN
        RAISE EXCEPTION 'FENN_VALIDATION: invalid effect payload' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.x_perception_effects (
        authorization_id,
        perception_event_id,
        effect_type,
        idempotency_key,
        payload,
        status
      )
      VALUES (
        v_auth_id,
        p_perception_event_id,
        v_effect_type,
        v_key,
        v_payload,
        'pending'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;
  END IF;

  SELECT count(*)::integer INTO v_effects_created
  FROM public.x_perception_effects e
  WHERE e.authorization_id = v_auth_id;

  created := true;
  authorization_id := v_auth_id;
  outcome := p_outcome;
  policy_code := p_policy_code;
  effects_created := v_effects_created;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.persist_x_perception_authorization(
  uuid, uuid, text, text, text, text, text, jsonb
) IS
  'Idempotent Stage 12.5 authority + pending effects. service_role only.';

REVOKE ALL ON FUNCTION public.persist_x_perception_authorization(
  uuid, uuid, text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_x_perception_authorization(
  uuid, uuid, text, text, text, text, text, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_x_perception_authorization(
  uuid, uuid, text, text, text, text, text, jsonb
) TO service_role;
