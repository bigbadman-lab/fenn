-- FENN — Greenwood Fire messages (FENN SPEAKS)
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- One current published message for Greenwood members.
-- Operator-managed via Desk/Admin trusted server paths only.
-- Not a member posting surface.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE public.greenwood_fire_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  status text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  published_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT greenwood_fire_messages_body_nonempty
    CHECK (char_length(btrim(body)) > 0),
  CONSTRAINT greenwood_fire_messages_body_max
    CHECK (char_length(body) <= 2000),
  CONSTRAINT greenwood_fire_messages_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT greenwood_fire_messages_published_requires_at
    CHECK (
      (status = 'published' AND published_at IS NOT NULL)
      OR (status <> 'published')
    )
);

CREATE UNIQUE INDEX greenwood_fire_messages_one_published_uidx
  ON public.greenwood_fire_messages (status)
  WHERE status = 'published';

CREATE INDEX greenwood_fire_messages_status_created_idx
  ON public.greenwood_fire_messages (status, created_at DESC);

CREATE TRIGGER greenwood_fire_messages_set_updated_at
  BEFORE UPDATE ON public.greenwood_fire_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.greenwood_fire_messages IS
  'FENN SPEAKS at The Fire. At most one published row. Service-role / trusted server only.';

ALTER TABLE public.greenwood_fire_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.greenwood_fire_messages FROM anon, authenticated;

-- Seed the Living Greenwood 1 hardcoded message as the first publication.
INSERT INTO public.greenwood_fire_messages (
  body,
  status,
  published_at,
  created_by_profile_id,
  published_by_profile_id
)
VALUES (
  E'The fire is small.\nIt has only just been lit.\nThose who arrive now will decide what it becomes.',
  'published',
  timezone('utc', now()),
  NULL,
  NULL
);

-- ---------------------------------------------------------------------------
-- Publish RPC — archive current published, publish selected draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_greenwood_fire_message(
  p_message_id uuid,
  p_actor_profile_id uuid
)
RETURNS TABLE (
  status text,
  message_id uuid,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.greenwood_fire_messages%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: message_id required'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.*
  INTO v_row
  FROM public.greenwood_fire_messages AS m
  WHERE m.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_FIRE_MESSAGE_NOT_FOUND: message does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status = 'published' THEN
    status := 'already_published';
    message_id := v_row.id;
    published_at := v_row.published_at;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'FENN_FIRE_MESSAGE_NOT_DRAFT: only drafts may be published'
      USING ERRCODE = 'P0001';
  END IF;

  -- Archive any currently published message (at most one by unique index).
  UPDATE public.greenwood_fire_messages AS m
  SET
    status = 'archived',
    updated_at = v_now
  WHERE m.status = 'published'
    AND m.id <> p_message_id;

  UPDATE public.greenwood_fire_messages AS m
  SET
    status = 'published',
    published_at = v_now,
    published_by_profile_id = p_actor_profile_id,
    updated_at = v_now
  WHERE m.id = p_message_id
    AND m.status = 'draft'
  RETURNING m.id, m.published_at
  INTO message_id, published_at;

  IF message_id IS NULL THEN
    RAISE EXCEPTION 'FENN_FIRE_MESSAGE_PUBLISH_RACE: draft was altered concurrently'
      USING ERRCODE = 'P0001';
  END IF;

  status := 'published';
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.publish_greenwood_fire_message(uuid, uuid) IS
  'Atomically archive the current published Fire message and publish a draft. Idempotent if already published.';

REVOKE ALL ON FUNCTION public.publish_greenwood_fire_message(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_greenwood_fire_message(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_greenwood_fire_message(uuid, uuid) TO service_role;
