-- FENN Clearing 1.0D — atomic rate limit + accepted-message three-cap fix
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- 1. Traveller allowance counts published AND hidden (accepted historical posts).
-- 2. Atomic consume_clearing_rate_bucket for multi-instance safety.
-- service_role only.

-- ---------------------------------------------------------------------------
-- post_clearing_message: count accepted (published+hidden), not only published
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_clearing_message(
  p_author_type text,
  p_traveller_id uuid,
  p_profile_id uuid,
  p_display_name text,
  p_body text,
  p_client_request_id uuid
)
RETURNS public.clearing_messages
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing public.clearing_messages;
  v_count integer;
  v_row public.clearing_messages;
  v_body text := nullif(trim(p_body), '');
  v_name text := nullif(trim(p_display_name), '');
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id required'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_body IS NULL OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'invalid_body'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NULL OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'invalid_display_name'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_author_type = 'traveller' THEN
    IF p_traveller_id IS NULL OR p_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_author'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
    FROM public.clearing_messages
    WHERE traveller_id = p_traveller_id
      AND client_request_id = p_client_request_id;

    IF FOUND THEN
      RETURN v_existing;
    END IF;

    -- Lock Traveller row for serialised allowance checks
    PERFORM 1
    FROM public.clearing_travellers
    WHERE id = p_traveller_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'traveller_not_found'
        USING ERRCODE = 'P0001';
    END IF;

    -- Accepted = published or hidden (hide does not free a Traveller slot)
    SELECT count(*)::integer INTO v_count
    FROM public.clearing_messages
    WHERE traveller_id = p_traveller_id
      AND status IN ('published', 'hidden');

    IF v_count >= 3 THEN
      RAISE EXCEPTION 'registration_required'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.clearing_messages (
      author_type,
      traveller_id,
      profile_id,
      author_display_name_snapshot,
      body,
      status,
      client_request_id
    )
    VALUES (
      'traveller',
      p_traveller_id,
      NULL,
      v_name,
      v_body,
      'published',
      p_client_request_id
    )
    RETURNING * INTO v_row;

    UPDATE public.clearing_travellers
    SET last_seen_at = timezone('utc', now())
    WHERE id = p_traveller_id;

    RETURN v_row;
  END IF;

  IF p_author_type IN ('outlaw', 'keeper') THEN
    IF p_profile_id IS NULL OR p_traveller_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_author'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
    FROM public.clearing_messages
    WHERE profile_id = p_profile_id
      AND client_request_id = p_client_request_id;

    IF FOUND THEN
      RETURN v_existing;
    END IF;

    INSERT INTO public.clearing_messages (
      author_type,
      traveller_id,
      profile_id,
      author_display_name_snapshot,
      body,
      status,
      client_request_id
    )
    VALUES (
      p_author_type,
      NULL,
      p_profile_id,
      v_name,
      v_body,
      'published',
      p_client_request_id
    )
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  RAISE EXCEPTION 'invalid_author_type'
    USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION public.post_clearing_message IS
  'Atomic Clearing post. Traveller: lock + max 3 accepted (published|hidden). Idempotent on client_request_id.';

-- ---------------------------------------------------------------------------
-- Atomic fixed-window rate bucket consume
-- Returns hit after consume; raises rate_limited when over max.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_clearing_rate_bucket(
  p_bucket_key text,
  p_window_start timestamptz,
  p_max_hits integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_key text := nullif(trim(p_bucket_key), '');
  v_hits integer;
BEGIN
  IF v_key IS NULL OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_bucket_key'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_window_start IS NULL THEN
    RAISE EXCEPTION 'invalid_window_start'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_max_hits IS NULL OR p_max_hits <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.clearing_rate_buckets AS b (
    bucket_key,
    window_start,
    hit_count
  )
  VALUES (
    v_key,
    p_window_start,
    1
  )
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    window_start = EXCLUDED.window_start,
    hit_count = CASE
      WHEN b.window_start IS DISTINCT FROM EXCLUDED.window_start THEN 1
      ELSE b.hit_count + 1
    END
  RETURNING hit_count INTO v_hits;

  IF v_hits > p_max_hits THEN
    -- Clamp so a retry cannot leave unbounded inflation within the window
    UPDATE public.clearing_rate_buckets
    SET hit_count = p_max_hits
    WHERE bucket_key = v_key
      AND window_start = p_window_start
      AND hit_count > p_max_hits;

    RAISE EXCEPTION 'rate_limited'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_hits;
END;
$$;

COMMENT ON FUNCTION public.consume_clearing_rate_bucket IS
  'Atomic Clearing rate-limit counter. Multi-instance safe. service_role only.';

REVOKE ALL ON FUNCTION public.consume_clearing_rate_bucket(
  text, timestamptz, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_clearing_rate_bucket(
  text, timestamptz, integer
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_clearing_rate_bucket(
  text, timestamptz, integer
) TO service_role;

-- Keep post RPC grants
REVOKE ALL ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) TO service_role;

-- Index supporting accepted-count path for traveller allowance
CREATE INDEX IF NOT EXISTS clearing_messages_traveller_accepted_status_idx
  ON public.clearing_messages (traveller_id, status)
  WHERE traveller_id IS NOT NULL
    AND status IN ('published', 'hidden');
