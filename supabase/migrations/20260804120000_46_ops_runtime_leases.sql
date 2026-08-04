-- FENN X agent production — global Postgres runtime lease
-- Additive. Prevents overlapping minute invocations without in-memory mutexes.
-- service_role only.

CREATE TABLE public.ops_runtime_leases (
  lease_key text PRIMARY KEY,
  holder_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at timestamptz NOT NULL,

  CONSTRAINT ops_runtime_leases_key_nonempty
    CHECK (length(trim(lease_key)) > 0),
  CONSTRAINT ops_runtime_leases_holder_nonempty
    CHECK (length(trim(holder_id)) > 0),
  CONSTRAINT ops_runtime_leases_expires_after_acquired
    CHECK (expires_at > acquired_at)
);

COMMENT ON TABLE public.ops_runtime_leases IS
  'Global process leases for ops runtimes (e.g. X agent cron). service_role only.';

ALTER TABLE public.ops_runtime_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ops_runtime_leases FROM PUBLIC;
REVOKE ALL ON TABLE public.ops_runtime_leases FROM anon, authenticated;
GRANT ALL ON TABLE public.ops_runtime_leases TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic acquire (insert or steal expired, or extend same holder)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_acquire_ops_runtime_lease(
  p_lease_key text,
  p_holder_id text,
  p_ttl_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key text := nullif(trim(p_lease_key), '');
  v_holder text := nullif(trim(p_holder_id), '');
  v_ttl integer := greatest(coalesce(p_ttl_seconds, 1), 1);
  v_now timestamptz := timezone('utc', now());
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
BEGIN
  IF v_key IS NULL OR v_holder IS NULL THEN
    RAISE EXCEPTION 'lease_key and holder_id are required';
  END IF;

  INSERT INTO public.ops_runtime_leases (
    lease_key,
    holder_id,
    acquired_at,
    expires_at
  )
  VALUES (
    v_key,
    v_holder,
    v_now,
    v_expires
  )
  ON CONFLICT (lease_key) DO NOTHING;

  IF FOUND THEN
    RETURN true;
  END IF;

  UPDATE public.ops_runtime_leases
  SET
    holder_id = v_holder,
    acquired_at = v_now,
    expires_at = v_expires
  WHERE lease_key = v_key
    AND expires_at < v_now;

  IF FOUND THEN
    RETURN true;
  END IF;

  -- Same holder refresh (re-entrant cron / test)
  UPDATE public.ops_runtime_leases
  SET
    acquired_at = v_now,
    expires_at = v_expires
  WHERE lease_key = v_key
    AND holder_id = v_holder;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.try_acquire_ops_runtime_lease(text, text, integer) IS
  'Acquire a non-overlapping ops runtime lease. Returns false when held by another active holder.';

REVOKE ALL ON FUNCTION public.try_acquire_ops_runtime_lease(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_ops_runtime_lease(text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_ops_runtime_lease(text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Release only if caller still holds the lease
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_ops_runtime_lease(
  p_lease_key text,
  p_holder_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key text := nullif(trim(p_lease_key), '');
  v_holder text := nullif(trim(p_holder_id), '');
BEGIN
  IF v_key IS NULL OR v_holder IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.ops_runtime_leases
  WHERE lease_key = v_key
    AND holder_id = v_holder;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_ops_runtime_lease(text, text) IS
  'Release an ops runtime lease when held by the given holder.';

REVOKE ALL ON FUNCTION public.release_ops_runtime_lease(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_ops_runtime_lease(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ops_runtime_lease(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Cheap work probe (no OpenAI / X). Existence checks only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.probe_x_agent_internal_work()
RETURNS TABLE (
  pending_perceptions boolean,
  pending_sight boolean,
  pending_authority boolean,
  pending_effects boolean,
  has_work boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM public.x_perception_events e
        WHERE e.status = 'pending'
        LIMIT 1
      ) AS pending_perceptions,
      EXISTS (
        SELECT 1
        FROM public.x_perception_judgements j
        WHERE j.final_status = 'pending'
        LIMIT 1
      ) AS pending_sight,
      EXISTS (
        SELECT 1
        FROM public.x_perception_judgements j
        WHERE j.final_status = 'finalized'
          AND NOT EXISTS (
            SELECT 1
            FROM public.x_perception_authorizations a
            WHERE a.perception_event_id = j.perception_event_id
          )
        LIMIT 1
      ) AS pending_authority,
      EXISTS (
        SELECT 1
        FROM public.x_perception_effects e
        WHERE e.status = 'pending'
           OR (
             e.status = 'failed'
             AND (e.failure_class IS NULL OR e.failure_class = 'retryable')
           )
        LIMIT 1
      ) AS pending_effects
  )
  SELECT
    c.pending_perceptions,
    c.pending_sight,
    c.pending_authority,
    c.pending_effects,
    (
      c.pending_perceptions
      OR c.pending_sight
      OR c.pending_authority
      OR c.pending_effects
    ) AS has_work
  FROM counts c;
$$;

COMMENT ON FUNCTION public.probe_x_agent_internal_work() IS
  'Cheap X agent queue probe. No external provider calls.';

REVOKE ALL ON FUNCTION public.probe_x_agent_internal_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.probe_x_agent_internal_work() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.probe_x_agent_internal_work() TO service_role;
