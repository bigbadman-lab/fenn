-- FENN Stage 2 — Migration 04: Camp
-- LOCAL ONLY — do not apply until explicitly authorised.

-- ---------------------------------------------------------------------------
-- camp_characters
-- ---------------------------------------------------------------------------
CREATE TABLE public.camp_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  role_title text,
  -- Server-side prompt lookup key only — never store secret production prompts here.
  prompt_key text,
  is_active boolean NOT NULL DEFAULT true,
  is_locked boolean NOT NULL DEFAULT false,
  daily_leaf_cap integer,
  sort_order integer NOT NULL DEFAULT 0,
  ascii_art text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT camp_characters_slug_format
    CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT camp_characters_display_name_nonempty
    CHECK (length(trim(display_name)) > 0),
  CONSTRAINT camp_characters_daily_leaf_cap_nonnegative
    CHECK (daily_leaf_cap IS NULL OR daily_leaf_cap >= 0)
);

CREATE UNIQUE INDEX camp_characters_slug_uidx
  ON public.camp_characters (slug);

CREATE INDEX camp_characters_active_sort_idx
  ON public.camp_characters (is_active, sort_order);

CREATE TRIGGER camp_characters_set_updated_at
  BEFORE UPDATE ON public.camp_characters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.camp_characters IS
  'Camp AI character identities. prompt_key references server config; prompts are not stored here.';

-- Safe identity seeds only (no prompts, caps, or reward policy).
INSERT INTO public.camp_characters (slug, display_name, role_title, prompt_key, is_active, is_locked, sort_order)
VALUES
  ('fenn', 'FENN', 'Central intelligence', 'camp.character.fenn', true, false, 1),
  ('wren', 'WREN', 'The Listener', 'camp.character.wren', true, false, 2),
  ('rook', 'ROOK', 'The Watcher', 'camp.character.rook', true, false, 3);

-- ---------------------------------------------------------------------------
-- camp_sessions (one continuing session per profile × character)
-- ---------------------------------------------------------------------------
CREATE TABLE public.camp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  character_id uuid NOT NULL REFERENCES public.camp_characters (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT camp_sessions_message_count_nonnegative
    CHECK (message_count >= 0)
);

CREATE UNIQUE INDEX camp_sessions_profile_character_uidx
  ON public.camp_sessions (profile_id, character_id);

CREATE INDEX camp_sessions_profile_last_message_idx
  ON public.camp_sessions (profile_id, last_message_at DESC NULLS LAST);

CREATE TRIGGER camp_sessions_set_updated_at
  BEFORE UPDATE ON public.camp_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.camp_sessions IS
  'Persistent Camp conversation continuity per profile and character.';

-- ---------------------------------------------------------------------------
-- camp_messages
-- ---------------------------------------------------------------------------
CREATE TABLE public.camp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.camp_sessions (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  character_id uuid NOT NULL REFERENCES public.camp_characters (id) ON DELETE RESTRICT,
  role text NOT NULL,
  content text NOT NULL,
  -- Model may recommend; never authoritative for balances.
  reward_recommendation integer,
  reward_granted integer NOT NULL DEFAULT 0,
  quality smallint,
  originality smallint,
  relevance smallint,
  spam_probability numeric(5, 4),
  memory_candidate_flag boolean NOT NULL DEFAULT false,
  leaf_ledger_id uuid REFERENCES public.leaf_ledger (id) ON DELETE RESTRICT,
  client_message_hash text,
  moderation_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT camp_messages_role_check
    CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT camp_messages_content_nonempty
    CHECK (length(trim(content)) > 0),
  CONSTRAINT camp_messages_reward_granted_nonnegative
    CHECK (reward_granted >= 0),
  CONSTRAINT camp_messages_spam_probability_range
    CHECK (
      spam_probability IS NULL
      OR (spam_probability >= 0 AND spam_probability <= 1)
    )
);

CREATE INDEX camp_messages_session_created_at_idx
  ON public.camp_messages (session_id, created_at);

CREATE INDEX camp_messages_profile_created_at_idx
  ON public.camp_messages (profile_id, created_at DESC);

CREATE INDEX camp_messages_memory_candidate_idx
  ON public.camp_messages (created_at DESC)
  WHERE memory_candidate_flag = true;

CREATE UNIQUE INDEX camp_messages_session_hash_uidx
  ON public.camp_messages (session_id, client_message_hash)
  WHERE client_message_hash IS NOT NULL;

COMMENT ON TABLE public.camp_messages IS
  'Camp message history and evaluation metadata. reward_recommendation is never accounting authority.';
COMMENT ON COLUMN public.camp_messages.reward_recommendation IS
  'LLM suggestion only. LEAF changes require leaf_ledger rows written by trusted server code.';

-- ---------------------------------------------------------------------------
-- camp_daily_rewards (per-character and global via NULL character_id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.camp_daily_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  reward_date date NOT NULL,
  -- NULL character_id = global Camp daily total for the profile/date.
  character_id uuid REFERENCES public.camp_characters (id) ON DELETE RESTRICT,
  leaf_granted integer NOT NULL DEFAULT 0,
  rewarded_message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT camp_daily_rewards_leaf_granted_nonnegative
    CHECK (leaf_granted >= 0),
  CONSTRAINT camp_daily_rewards_message_count_nonnegative
    CHECK (rewarded_message_count >= 0)
);

-- PG15+: NULLS NOT DISTINCT so one global row (character_id NULL) per profile/date.
CREATE UNIQUE INDEX camp_daily_rewards_profile_date_character_uidx
  ON public.camp_daily_rewards (profile_id, reward_date, character_id)
  NULLS NOT DISTINCT;

CREATE INDEX camp_daily_rewards_profile_date_idx
  ON public.camp_daily_rewards (profile_id, reward_date);

CREATE TRIGGER camp_daily_rewards_set_updated_at
  BEFORE UPDATE ON public.camp_daily_rewards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.camp_daily_rewards IS
  'Daily Camp LEAF accounting. character_id NULL means global Camp cap row for that day.';
