-- P2A: type-scoped effect claims + purse official-settlement activation + economic brake
-- Safe defaults for pre-launch: activation NULL, economic_settlement_enabled true
-- (brake is explicit OFF = stop new claims; idle on missing official is application-layer)

-- ---------------------------------------------------------------------------
-- purse_config: activation + emergency economic brake
-- ---------------------------------------------------------------------------
ALTER TABLE public.purse_config
  ADD COLUMN IF NOT EXISTS official_settlement_activated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS economic_settlement_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.purse_config.official_settlement_activated_at IS
  'UTC instant when official FENN settlement first activated. Immutable once set (application + try_activate RPC). NULL = never activated.';

COMMENT ON COLUMN public.purse_config.economic_settlement_enabled IS
  'Emergency brake for Purse Executor. false = claim none / sign none; leave effects pending. Independent of official activation.';

-- ---------------------------------------------------------------------------
-- Atomic set-once activation (no auto-activate on deploy)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_activate_official_settlement()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  -- Only set if currently null. Concurrent ticks: one row wins.
  UPDATE public.purse_config
  SET
    official_settlement_activated_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE official_settlement_activated_at IS NULL
  RETURNING official_settlement_activated_at INTO v_at;

  IF v_at IS NOT NULL THEN
    RETURN v_at;
  END IF;

  SELECT official_settlement_activated_at INTO v_at
  FROM public.purse_config
  LIMIT 1;

  RETURN v_at;
END;
$$;

COMMENT ON FUNCTION public.try_activate_official_settlement() IS
  'Set purse_config.official_settlement_activated_at once if null. service_role only. App must only call when official FENN resolves.';

REVOKE ALL ON FUNCTION public.try_activate_official_settlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_activate_official_settlement() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_activate_official_settlement() TO service_role;

-- ---------------------------------------------------------------------------
-- Type-scoped claim (empty/null type filter = claim NOTHING — fail closed)
-- Stale processing reclaim: processing older than 15 minutes may be reclaimed.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_x_perception_effect(text);

CREATE OR REPLACE FUNCTION public.claim_x_perception_effect(
  p_effect_types text[],
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
  x_post_id text,
  effect_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_types text[];
BEGIN
  -- Fail closed: missing or empty type list claims nothing.
  IF p_effect_types IS NULL OR coalesce(array_length(p_effect_types, 1), 0) = 0 THEN
    RETURN;
  END IF;

  -- Whitelist only known Stage 12 effect types (reject injection of garbage into claim).
  SELECT array_agg(DISTINCT t)
  INTO v_types
  FROM unnest(p_effect_types) AS t
  WHERE t IN ('reply_on_x', 'write_to_wall', 'transfer_fenn', 'burn_fenn');

  IF v_types IS NULL OR coalesce(array_length(v_types, 1), 0) = 0 THEN
    RETURN;
  END IF;

  IF p_x_post_id IS NOT NULL AND length(trim(p_x_post_id)) > 0 THEN
    SELECT e.id INTO v_id
    FROM public.x_perception_effects e
    JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
    WHERE ev.x_post_id = trim(p_x_post_id)
      AND e.effect_type = ANY (v_types)
      AND (
        e.status = 'pending'
        OR (e.status = 'failed' AND e.failure_class = 'retryable')
        OR (
          e.status = 'processing'
          AND e.updated_at < timezone('utc', now()) - interval '15 minutes'
        )
      )
    ORDER BY e.created_at ASC
    FOR UPDATE OF e SKIP LOCKED
    LIMIT 1;
  ELSE
    SELECT e.id INTO v_id
    FROM public.x_perception_effects e
    WHERE e.effect_type = ANY (v_types)
      AND (
        e.status = 'pending'
        OR (e.status = 'failed' AND e.failure_class = 'retryable')
        OR (
          e.status = 'processing'
          AND e.updated_at < timezone('utc', now()) - interval '15 minutes'
        )
      )
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
    ev.x_post_id,
    e.created_at
  FROM public.x_perception_effects e
  JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
  WHERE e.id = v_id;
END;
$$;

COMMENT ON FUNCTION public.claim_x_perception_effect(text[], text) IS
  'Claim one pending/retryable/stale-processing effect among allowed types only. Empty types claim nothing. service_role only.';

REVOKE ALL ON FUNCTION public.claim_x_perception_effect(text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_x_perception_effect(text[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_perception_effect(text[], text) TO service_role;

-- Optional list filter helper (economic counts for purse executor)
DROP FUNCTION IF EXISTS public.list_pending_x_perception_effects(integer);

CREATE OR REPLACE FUNCTION public.list_pending_x_perception_effects(
  p_limit integer DEFAULT 20,
  p_effect_types text[] DEFAULT NULL
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
  v_types text[];
BEGIN
  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));

  IF p_effect_types IS NOT NULL AND coalesce(array_length(p_effect_types, 1), 0) > 0 THEN
    SELECT array_agg(DISTINCT t)
    INTO v_types
    FROM unnest(p_effect_types) AS t
    WHERE t IN ('reply_on_x', 'write_to_wall', 'transfer_fenn', 'burn_fenn');
  END IF;

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
      WHEN e.effect_type = 'transfer_fenn' THEN left(
        coalesce(e.payload->>'amountFormatted', '') || ' → ' || coalesce(e.payload->>'recipientAddress', ''),
        80
      )
      WHEN e.effect_type = 'burn_fenn' THEN left(
        'BURN ' || coalesce(e.payload->>'amountFormatted', ''),
        80
      )
      ELSE NULL
    END
  FROM public.x_perception_effects e
  JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
  WHERE (
      e.status = 'pending'
      OR (e.status = 'failed' AND e.failure_class = 'retryable')
    )
    AND (
      v_types IS NULL
      OR e.effect_type = ANY (v_types)
    )
  ORDER BY e.created_at ASC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.list_pending_x_perception_effects(integer, text[]) IS
  'List pending/retryable effects. Optional type filter. service_role only.';

REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_x_perception_effects(integer, text[]) TO service_role;
