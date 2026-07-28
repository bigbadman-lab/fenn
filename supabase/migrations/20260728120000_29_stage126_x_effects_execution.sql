-- FENN Stage 12.6 — Trusted effect execution + X OAuth credentials
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Extends Stage 12.5 effects for execution evidence.
-- Persists rotating @askfenn OAuth tokens (service_role only).

-- ---------------------------------------------------------------------------
-- A) Effect execution evidence columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.x_perception_effects
  ADD COLUMN IF NOT EXISTS external_result_id text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_class text;

ALTER TABLE public.x_perception_effects
  DROP CONSTRAINT IF EXISTS x_perception_effects_failure_class_check;

ALTER TABLE public.x_perception_effects
  ADD CONSTRAINT x_perception_effects_failure_class_check
  CHECK (
    failure_class IS NULL
    OR failure_class IN ('retryable', 'terminal', 'ambiguous')
  );

COMMENT ON COLUMN public.x_perception_effects.external_result_id IS
  'Application-owned external consequence id (X post id or Wall entry id).';
COMMENT ON COLUMN public.x_perception_effects.completed_at IS
  'When status became completed.';
COMMENT ON COLUMN public.x_perception_effects.failure_class IS
  'retryable | terminal | ambiguous. Ambiguous X writes must not auto-retry.';

CREATE INDEX IF NOT EXISTS x_perception_effects_pending_retry_idx
  ON public.x_perception_effects (status, failure_class, created_at ASC)
  WHERE status IN ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- B) X OAuth credentials — single active @askfenn binding (MVP)
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_oauth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL DEFAULT 'askfenn',
  x_user_id text NOT NULL,
  x_username text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_type text NOT NULL DEFAULT 'bearer',
  scope text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_oauth_credentials_slot_check
    CHECK (slot = 'askfenn'),
  CONSTRAINT x_oauth_credentials_x_user_id_nonempty
    CHECK (length(trim(x_user_id)) > 0 AND x_user_id ~ '^[0-9]+$'),
  CONSTRAINT x_oauth_credentials_x_username_nonempty
    CHECK (length(trim(x_username)) > 0),
  CONSTRAINT x_oauth_credentials_access_nonempty
    CHECK (length(trim(access_token)) > 0),
  CONSTRAINT x_oauth_credentials_refresh_nonempty
    CHECK (length(trim(refresh_token)) > 0)
);

CREATE UNIQUE INDEX x_oauth_credentials_slot_uidx
  ON public.x_oauth_credentials (slot);

CREATE TRIGGER x_oauth_credentials_set_updated_at
  BEFORE UPDATE ON public.x_oauth_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.x_oauth_credentials IS
  'Stage 12.6 rotating @askfenn OAuth tokens. service_role only. Never browser-accessible.';

-- ---------------------------------------------------------------------------
-- C) Short-lived PKCE sessions for operator OAuth start
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_oauth_pkce_sessions (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,

  CONSTRAINT x_oauth_pkce_state_nonempty
    CHECK (length(trim(state)) >= 16),
  CONSTRAINT x_oauth_pkce_verifier_nonempty
    CHECK (length(trim(code_verifier)) >= 43)
);

CREATE INDEX x_oauth_pkce_sessions_expires_idx
  ON public.x_oauth_pkce_sessions (expires_at);

COMMENT ON TABLE public.x_oauth_pkce_sessions IS
  'Ephemeral PKCE verifiers for admin-started X OAuth. service_role only.';

-- ---------------------------------------------------------------------------
-- D) Browser lockdown
-- ---------------------------------------------------------------------------
ALTER TABLE public.x_oauth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_oauth_pkce_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_oauth_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.x_oauth_pkce_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- E) Claim one executable effect (pending, or failed+retryable)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_x_perception_effect(
  p_x_post_id text DEFAULT NULL
)
RETURNS TABLE (
  effect_id uuid,
  authorization_id uuid,
  perception_event_id uuid,
  effect_type text,
  idempotency_key text,
  payload jsonb,
  status text,
  attempt_count integer,
  x_post_id text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_x_post_id IS NOT NULL AND length(trim(p_x_post_id)) > 0 THEN
    SELECT e.id INTO v_id
    FROM public.x_perception_effects e
    JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
    WHERE ev.x_post_id = trim(p_x_post_id)
      AND (
        e.status = 'pending'
        OR (e.status = 'failed' AND e.failure_class = 'retryable')
      )
    ORDER BY e.created_at ASC
    FOR UPDATE OF e SKIP LOCKED
    LIMIT 1;
  ELSE
    SELECT e.id INTO v_id
    FROM public.x_perception_effects e
    WHERE e.status = 'pending'
       OR (e.status = 'failed' AND e.failure_class = 'retryable')
    ORDER BY e.created_at ASC
    FOR UPDATE OF e SKIP LOCKED
    LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.x_perception_effects e
  SET
    status = 'processing',
    attempt_count = e.attempt_count + 1,
    last_error = NULL,
    failure_class = NULL,
    updated_at = timezone('utc', now())
  WHERE e.id = v_id;

  RETURN QUERY
  SELECT
    e.id,
    e.authorization_id,
    e.perception_event_id,
    e.effect_type,
    e.idempotency_key,
    e.payload,
    e.status,
    e.attempt_count,
    ev.x_post_id
  FROM public.x_perception_effects e
  JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
  WHERE e.id = v_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_effect(text) IS
  'Claim one pending/retryable Stage 12.5 effect for Stage 12.6 execution. service_role only.';

REVOKE ALL ON FUNCTION public.claim_x_perception_effect(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_effect(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_effect(text) TO service_role;

-- ---------------------------------------------------------------------------
-- F) Complete / fail effect
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_x_perception_effect(
  p_effect_id uuid,
  p_external_result_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_effect_id IS NULL OR p_external_result_id IS NULL
     OR length(trim(p_external_result_id)) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: effect id and external_result_id required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.x_perception_effects
  SET
    status = 'completed',
    external_result_id = trim(p_external_result_id),
    completed_at = timezone('utc', now()),
    last_error = NULL,
    failure_class = NULL,
    updated_at = timezone('utc', now())
  WHERE id = p_effect_id
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_x_perception_effect(
  p_effect_id uuid,
  p_failure_class text,
  p_last_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_err text;
BEGIN
  IF p_effect_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: effect id required' USING ERRCODE = '22023';
  END IF;

  IF p_failure_class IS NULL OR p_failure_class NOT IN ('retryable', 'terminal', 'ambiguous') THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid failure_class' USING ERRCODE = '22023';
  END IF;

  v_err := left(coalesce(trim(p_last_error), 'execution_failed'), 500);

  UPDATE public.x_perception_effects
  SET
    status = 'failed',
    failure_class = p_failure_class,
    last_error = v_err,
    updated_at = timezone('utc', now())
  WHERE id = p_effect_id
    AND status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_x_perception_effect(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_x_perception_effect(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_x_perception_effect(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_x_perception_effect(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_x_perception_effect(uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_perception_effect(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- G) List pending effects (no claim / no mutation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_x_perception_effects(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  effect_id uuid,
  effect_type text,
  idempotency_key text,
  status text,
  failure_class text,
  attempt_count integer,
  x_post_id text,
  created_at timestamptz,
  payload_preview text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));

  RETURN QUERY
  SELECT
    e.id,
    e.effect_type,
    e.idempotency_key,
    e.status,
    e.failure_class,
    e.attempt_count,
    ev.x_post_id,
    e.created_at,
    CASE
      WHEN e.effect_type = 'reply_on_x' THEN left(coalesce(e.payload->>'text', ''), 80)
      WHEN e.effect_type = 'write_to_wall' THEN left(coalesce(e.payload->>'body', ''), 80)
      ELSE NULL
    END
  FROM public.x_perception_effects e
  JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
  WHERE e.status = 'pending'
     OR (e.status = 'failed' AND e.failure_class = 'retryable')
     OR (e.status = 'failed' AND e.failure_class = 'ambiguous')
  ORDER BY e.created_at ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_x_perception_effects(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- H) Atomic PKCE consume (prevents callback replay)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_x_oauth_pkce_session(
  p_state text
)
RETURNS TABLE (
  code_verifier text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.x_oauth_pkce_sessions s
  SET consumed_at = timezone('utc', now())
  WHERE s.state = trim(p_state)
    AND s.consumed_at IS NULL
    AND s.expires_at > timezone('utc', now())
  RETURNING s.code_verifier;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_x_oauth_pkce_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_x_oauth_pkce_session(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_x_oauth_pkce_session(text) TO service_role;
