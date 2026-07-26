-- FENN Stage 12.2.1 — fix ingest_x_perception_event status ambiguity
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- RETURNS TABLE (..., status text) shadowed the column name in RETURNING.
-- #variable_conflict use_column resolves INSERT/RETURNING against table columns.

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
