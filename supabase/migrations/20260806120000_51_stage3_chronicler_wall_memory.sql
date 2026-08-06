-- FENN Stage 3 — Chronicler durable Wall fact memory + judgement candidate persist
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Durable cross-post dedupe for approved public fact fingerprints.
-- One (fact_key, fact_fingerprint) may be remembered at most once.
-- Also stores final_wall_candidate on judgements so authorize can admit without
-- a second model call (operational Chronicler field, not browser-visible text).

-- ---------------------------------------------------------------------------
-- A) Durable fact memory
-- ---------------------------------------------------------------------------

CREATE TABLE public.x_wall_fact_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_key text NOT NULL,
  fact_fingerprint text NOT NULL,
  reason text NOT NULL,
  perception_event_id uuid REFERENCES public.x_perception_events (id) ON DELETE SET NULL,
  authorization_id uuid REFERENCES public.x_perception_authorizations (id) ON DELETE SET NULL,
  wall_entry_id uuid REFERENCES public.wall_entries (id) ON DELETE SET NULL,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_wall_fact_memories_fact_key_nonempty
    CHECK (length(trim(fact_key)) > 0 AND length(fact_key) <= 64),
  CONSTRAINT x_wall_fact_memories_fingerprint_nonempty
    CHECK (length(trim(fact_fingerprint)) > 0 AND length(fact_fingerprint) <= 256),
  CONSTRAINT x_wall_fact_memories_reason_check
    CHECK (reason IN (
      'first_observation',
      'milestone_reached',
      'meaningful_state_change',
      'constitutional_declaration',
      'exceptional_exchange'
    )),
  CONSTRAINT x_wall_fact_memories_fact_key_allowlist
    CHECK (fact_key IN (
      'confirmed_outlaw_count',
      'greenwood_member_count',
      'greenwood_leaf_threshold',
      'official_fenn_token',
      'current_public_gathering'
    ))
);

CREATE UNIQUE INDEX x_wall_fact_memories_key_fp_uidx
  ON public.x_wall_fact_memories (fact_key, fact_fingerprint);

CREATE INDEX x_wall_fact_memories_created_idx
  ON public.x_wall_fact_memories (created_at DESC);

CREATE INDEX x_wall_fact_memories_perception_idx
  ON public.x_wall_fact_memories (perception_event_id)
  WHERE perception_event_id IS NOT NULL;

COMMENT ON TABLE public.x_wall_fact_memories IS
  'Stage 3 Chronicler: durable public-fact fingerprints admitted to the Wall. No reply text or private user data. Server-owned only.';

COMMENT ON COLUMN public.x_wall_fact_memories.fact_fingerprint IS
  'Application-built canonical fingerprint (e.g. confirmed_outlaw_count:v=2). Unique with fact_key.';

-- Browser lockdown
ALTER TABLE public.x_wall_fact_memories ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_wall_fact_memories FROM PUBLIC;
REVOKE ALL ON TABLE public.x_wall_fact_memories FROM anon, authenticated;
GRANT ALL ON TABLE public.x_wall_fact_memories TO service_role;

-- ---------------------------------------------------------------------------
-- B) Persist final Wall candidate on judgements (authorize path)
-- ---------------------------------------------------------------------------

ALTER TABLE public.x_perception_judgements
ADD COLUMN IF NOT EXISTS final_wall_candidate jsonb;

COMMENT ON COLUMN public.x_perception_judgements.final_wall_candidate IS
  'Stage 3 optional structured Wall candidate from final judge (normalized). No execution authority fields.';

-- ---------------------------------------------------------------------------
-- C) Extend finalize_x_perception_judgement_with_live_state with candidate
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
  p_final_prompt_version text,
  p_final_wall_candidate jsonb DEFAULT NULL
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
    END
  WHERE perception_event_id = p_perception_event_id;

  created := true;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb
) IS
  'Finalize Stage 12.4 judgement with live-state results and optional Wall candidate.';

REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_x_perception_judgement_with_live_state(
  uuid, text, boolean, text[], text[],
  text, text, boolean, text, text, boolean, text, text, jsonb
) TO service_role;

-- Drop older 13-arg signature if still present (idempotent-ish).
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.finalize_x_perception_judgement_with_live_state(
    uuid, text, boolean, text[], text[],
    text, text, boolean, text, text, boolean, text, text
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- D) Claim for authority returns final_wall_candidate
-- ---------------------------------------------------------------------------

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
  final_wall_candidate jsonb
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
    j.final_wall_candidate
  FROM public.x_perception_events e
  JOIN public.x_perception_judgements j
    ON j.perception_event_id = e.id
  WHERE e.id = v_event_id
    AND j.id = v_judgement_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_for_authority() IS
  'Claim one finalized judgement for Stage 12.5 authority (includes Wall candidate).';

REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_for_authority() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_for_authority() TO service_role;
