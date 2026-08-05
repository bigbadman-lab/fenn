-- FENN Clearing 1.0A — foundation
-- Human community conversation facts (not Camp AI, not Market Watch).
-- LOCAL ONLY — do not apply until explicitly authorised.
-- service_role writes. Anonymous clients never write directly.

-- ---------------------------------------------------------------------------
-- clearing_travellers
-- ---------------------------------------------------------------------------
CREATE TABLE public.clearing_travellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  muted_until timestamptz,
  banned_at timestamptz,

  CONSTRAINT clearing_travellers_display_name_nonempty
    CHECK (length(trim(display_name)) > 0),
  CONSTRAINT clearing_travellers_display_name_max
    CHECK (char_length(display_name) <= 64),
  CONSTRAINT clearing_travellers_display_name_prefix
    CHECK (display_name LIKE 'Traveller %')
);

COMMENT ON TABLE public.clearing_travellers IS
  'Ephemeral Clearing Traveller identities. Server-minted names only.';

CREATE INDEX clearing_travellers_created_at_idx
  ON public.clearing_travellers (created_at DESC);

-- ---------------------------------------------------------------------------
-- clearing_outlaw_moderation (mute/ban for registered Outlaws)
-- ---------------------------------------------------------------------------
CREATE TABLE public.clearing_outlaw_moderation (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  muted_until timestamptz,
  banned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.clearing_outlaw_moderation IS
  'Clearing mute/ban state for Outlaw profiles. Separate from Traveller rows.';

-- ---------------------------------------------------------------------------
-- clearing_messages — human speech only
-- ---------------------------------------------------------------------------
CREATE TABLE public.clearing_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_type text NOT NULL,
  traveller_id uuid REFERENCES public.clearing_travellers (id) ON DELETE RESTRICT,
  profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  author_display_name_snapshot text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'published',
  client_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  hidden_at timestamptz,
  hidden_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  moderation_reason text,

  CONSTRAINT clearing_messages_author_type_check
    CHECK (author_type IN ('traveller', 'outlaw', 'keeper')),
  CONSTRAINT clearing_messages_status_check
    CHECK (status IN ('published', 'hidden', 'rejected')),
  CONSTRAINT clearing_messages_body_nonempty
    CHECK (length(trim(body)) > 0),
  CONSTRAINT clearing_messages_body_max
    CHECK (char_length(body) <= 1000),
  CONSTRAINT clearing_messages_snapshot_nonempty
    CHECK (length(trim(author_display_name_snapshot)) > 0),
  CONSTRAINT clearing_messages_snapshot_max
    CHECK (char_length(author_display_name_snapshot) <= 80),
  CONSTRAINT clearing_messages_reason_max
    CHECK (
      moderation_reason IS NULL
      OR char_length(moderation_reason) <= 500
    ),
  -- Mutually exclusive traveller vs profile ownership for peer posts.
  CONSTRAINT clearing_messages_author_xor
    CHECK (
      (
        author_type = 'traveller'
        AND traveller_id IS NOT NULL
        AND profile_id IS NULL
      )
      OR (
        author_type IN ('outlaw', 'keeper')
        AND profile_id IS NOT NULL
        AND traveller_id IS NULL
      )
    )
);

COMMENT ON TABLE public.clearing_messages IS
  'Clearing human messages. No LEAF/AI/Market fields. Traveller XOR profile.';

-- Idempotency: one client request per Traveller
CREATE UNIQUE INDEX clearing_messages_traveller_request_uidx
  ON public.clearing_messages (traveller_id, client_request_id)
  WHERE traveller_id IS NOT NULL;

-- Idempotency: one client request per Outlaw/Keeper profile
CREATE UNIQUE INDEX clearing_messages_profile_request_uidx
  ON public.clearing_messages (profile_id, client_request_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX clearing_messages_feed_idx
  ON public.clearing_messages (created_at DESC, id DESC)
  WHERE status = 'published';

CREATE INDEX clearing_messages_traveller_accepted_idx
  ON public.clearing_messages (traveller_id, created_at)
  WHERE traveller_id IS NOT NULL AND status = 'published';

CREATE INDEX clearing_messages_profile_created_idx
  ON public.clearing_messages (profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- clearing_state — single global row
-- ---------------------------------------------------------------------------
CREATE TABLE public.clearing_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  read_only boolean NOT NULL DEFAULT false,
  slow_mode_seconds integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT clearing_state_slow_mode_nonneg
    CHECK (slow_mode_seconds >= 0 AND slow_mode_seconds <= 3600)
);

COMMENT ON TABLE public.clearing_state IS
  'Global Clearing mode (read-only, slow mode). Exactly one row.';

INSERT INTO public.clearing_state (id, read_only, slow_mode_seconds)
VALUES (1, false, 0);

-- ---------------------------------------------------------------------------
-- clearing_rate_buckets — network/global soft counters
-- ---------------------------------------------------------------------------
CREATE TABLE public.clearing_rate_buckets (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,

  CONSTRAINT clearing_rate_buckets_key_nonempty
    CHECK (length(trim(bucket_key)) > 0),
  CONSTRAINT clearing_rate_buckets_hits_nonneg
    CHECK (hit_count >= 0)
);

COMMENT ON TABLE public.clearing_rate_buckets IS
  'Rolling window counters for Clearing rate limits (service_role).';

-- ---------------------------------------------------------------------------
-- Atomic Traveller post (three-cap + idempotency)
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
    -- Note: concurrent posts serialize on this row; v_count is then authoritative.

    SELECT count(*)::integer INTO v_count
    FROM public.clearing_messages
    WHERE traveller_id = p_traveller_id
      AND status = 'published';

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
  'Atomic Clearing post. Traveller: lock + max 3 published. Idempotent on client_request_id.';

REVOKE ALL ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_clearing_message(
  text, uuid, uuid, text, text, uuid
) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS — no public writes
-- ---------------------------------------------------------------------------
ALTER TABLE public.clearing_travellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearing_outlaw_moderation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearing_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clearing_rate_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clearing_travellers FROM PUBLIC;
REVOKE ALL ON public.clearing_outlaw_moderation FROM PUBLIC;
REVOKE ALL ON public.clearing_messages FROM PUBLIC;
REVOKE ALL ON public.clearing_state FROM PUBLIC;
REVOKE ALL ON public.clearing_rate_buckets FROM PUBLIC;

REVOKE ALL ON public.clearing_travellers FROM anon, authenticated;
REVOKE ALL ON public.clearing_outlaw_moderation FROM anon, authenticated;
REVOKE ALL ON public.clearing_messages FROM anon, authenticated;
REVOKE ALL ON public.clearing_state FROM anon, authenticated;
REVOKE ALL ON public.clearing_rate_buckets FROM anon, authenticated;

GRANT ALL ON public.clearing_travellers TO service_role;
GRANT ALL ON public.clearing_outlaw_moderation TO service_role;
GRANT ALL ON public.clearing_messages TO service_role;
GRANT ALL ON public.clearing_state TO service_role;
GRANT ALL ON public.clearing_rate_buckets TO service_role;

-- No direct table access for anon/authenticated. API uses service_role + DTO.
-- Published feed is exposed only through server routes that strip private fields.
