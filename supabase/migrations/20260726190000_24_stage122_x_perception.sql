-- FENN Stage 12.2 — X event / perception layer
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Additive. Hear only — no judgement, posting, Wall, or memory writes.
--
-- X post IDs are text (snowflake strings). Never coerce via JS Number.

-- ---------------------------------------------------------------------------
-- x_perception_events
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_perception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  x_post_id text NOT NULL,
  perception_type text NOT NULL,
  author_x_user_id text NOT NULL,
  author_username text,
  author_display_name text,
  body text NOT NULL,
  conversation_id text,
  referenced_tweet_ids text[] NOT NULL DEFAULT '{}'::text[],
  x_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_perception_events_x_post_id_nonempty
    CHECK (length(trim(x_post_id)) > 0),
  CONSTRAINT x_perception_events_author_nonempty
    CHECK (length(trim(author_x_user_id)) > 0),
  CONSTRAINT x_perception_events_body_nonempty
    CHECK (length(trim(body)) > 0),
  CONSTRAINT x_perception_events_body_max
    CHECK (char_length(body) <= 8000),
  CONSTRAINT x_perception_events_type_check
    CHECK (perception_type IN ('mention', 'reply')),
  CONSTRAINT x_perception_events_status_check
    CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT x_perception_events_attempt_nonneg
    CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX x_perception_events_x_post_id_uidx
  ON public.x_perception_events (x_post_id);

CREATE INDEX x_perception_events_status_received_idx
  ON public.x_perception_events (status, received_at ASC);

CREATE INDEX x_perception_events_author_idx
  ON public.x_perception_events (author_x_user_id);

CREATE TRIGGER x_perception_events_set_updated_at
  BEFORE UPDATE ON public.x_perception_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.x_perception_events IS
  'Stage 12.2 durable X perceptions. Untrusted external content. Trusted server only. No browser access.';

COMMENT ON COLUMN public.x_perception_events.x_post_id IS
  'X snowflake post id as text. Unique. Never Number.';

COMMENT ON COLUMN public.x_perception_events.author_x_user_id IS
  'Immutable X author user id (text). Username is display-only.';

COMMENT ON COLUMN public.x_perception_events.body IS
  'Untrusted X text. Persisting does not grant authority or execute actions.';

-- ---------------------------------------------------------------------------
-- x_poll_state — durable since_id for mentions polling
-- ---------------------------------------------------------------------------
CREATE TABLE public.x_poll_state (
  key text PRIMARY KEY,
  since_id text,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_poll_state_key_nonempty
    CHECK (length(trim(key)) > 0),
  CONSTRAINT x_poll_state_since_id_nonempty
    CHECK (since_id IS NULL OR length(trim(since_id)) > 0)
);

CREATE TRIGGER x_poll_state_set_updated_at
  BEFORE UPDATE ON public.x_poll_state
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.x_poll_state (key, since_id)
VALUES ('mentions_askfenn', NULL)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.x_poll_state IS
  'Durable X poll cursors (since_id). Ephemeral processes must not be the only cursor store.';

-- ---------------------------------------------------------------------------
-- Browser lockdown
-- ---------------------------------------------------------------------------
ALTER TABLE public.x_perception_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_poll_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_perception_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.x_poll_state FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent ingest (service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_x_perception_event(
  p_x_post_id text,
  p_perception_type text,
  p_author_x_user_id text,
  p_author_username text,
  p_author_display_name text,
  p_body text,
  p_conversation_id text,
  p_referenced_tweet_ids text[],
  p_x_created_at timestamptz
)
RETURNS TABLE (
  created boolean,
  event_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_post text;
  v_author text;
  v_body text;
  v_type text;
  v_id uuid;
  v_status text;
BEGIN
  v_post := trim(COALESCE(p_x_post_id, ''));
  v_author := trim(COALESCE(p_author_x_user_id, ''));
  v_body := COALESCE(p_body, '');
  v_type := trim(COALESCE(p_perception_type, ''));

  IF length(v_post) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: x_post_id required' USING ERRCODE = '22023';
  END IF;
  IF length(v_author) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: author_x_user_id required' USING ERRCODE = '22023';
  END IF;
  IF length(trim(v_body)) = 0 THEN
    RAISE EXCEPTION 'FENN_VALIDATION: body required' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('mention', 'reply') THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invalid perception_type' USING ERRCODE = '22023';
  END IF;
  IF p_x_created_at IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: x_created_at required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.x_perception_events (
    x_post_id,
    perception_type,
    author_x_user_id,
    author_username,
    author_display_name,
    body,
    conversation_id,
    referenced_tweet_ids,
    x_created_at,
    status
  )
  VALUES (
    v_post,
    v_type,
    v_author,
    NULLIF(trim(COALESCE(p_author_username, '')), ''),
    NULLIF(trim(COALESCE(p_author_display_name, '')), ''),
    v_body,
    NULLIF(trim(COALESCE(p_conversation_id, '')), ''),
    COALESCE(p_referenced_tweet_ids, '{}'::text[]),
    p_x_created_at,
    'pending'
  )
  ON CONFLICT (x_post_id) DO NOTHING
  RETURNING id, status INTO v_id, v_status;

  IF v_id IS NOT NULL THEN
    created := true;
    event_id := v_id;
    status := v_status;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT e.id, e.status
  INTO v_id, v_status
  FROM public.x_perception_events e
  WHERE e.x_post_id = v_post;

  created := false;
  event_id := v_id;
  status := v_status;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.ingest_x_perception_event(
  text, text, text, text, text, text, text, text[], timestamptz
) IS
  'Idempotent X perception ingest by x_post_id. service_role only.';

REVOKE ALL ON FUNCTION public.ingest_x_perception_event(
  text, text, text, text, text, text, text, text[], timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_x_perception_event(
  text, text, text, text, text, text, text, text[], timestamptz
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_x_perception_event(
  text, text, text, text, text, text, text, text[], timestamptz
) TO service_role;
