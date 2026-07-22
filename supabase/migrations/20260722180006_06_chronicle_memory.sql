-- FENN Stage 2 — Migration 06: Chronicle & memory
-- LOCAL ONLY — do not apply until explicitly authorised.

-- ---------------------------------------------------------------------------
-- chronicle_entries (events + Notice Tree)
-- ---------------------------------------------------------------------------
CREATE TABLE public.chronicle_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  source_type text,
  source_id text,
  published_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by_actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT chronicle_entries_kind_check
    CHECK (kind IN (
      'notice',
      'milestone',
      'circulation',
      'treasury',
      'deed',
      'camp',
      'greenwood',
      'other'
    )),
  CONSTRAINT chronicle_entries_visibility_check
    CHECK (visibility IN ('public', 'greenwood', 'admin')),
  CONSTRAINT chronicle_entries_body_nonempty
    CHECK (length(trim(body)) > 0)
);

CREATE INDEX chronicle_entries_visibility_published_idx
  ON public.chronicle_entries (visibility, published_at DESC);

CREATE INDEX chronicle_entries_kind_published_idx
  ON public.chronicle_entries (kind, published_at DESC);

CREATE TRIGGER chronicle_entries_set_updated_at
  BEFORE UPDATE ON public.chronicle_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.chronicle_entries IS
  'Chronicle of events that occurred; also feeds Notice Tree for public/greenwood notices.';

-- ---------------------------------------------------------------------------
-- fenn_memories (Canon + approved Greenwood Memory)
-- No embedding column in Stage 2 (vector extension only).
-- ---------------------------------------------------------------------------
CREATE TABLE public.fenn_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layer text NOT NULL,
  title text,
  content text NOT NULL,
  source_candidate_id uuid,
  source_message_id uuid REFERENCES public.camp_messages (id) ON DELETE SET NULL,
  source_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  approved_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT fenn_memories_layer_check
    CHECK (layer IN ('canon', 'greenwood_memory')),
  CONSTRAINT fenn_memories_content_nonempty
    CHECK (length(trim(content)) > 0)
);

CREATE INDEX fenn_memories_layer_active_idx
  ON public.fenn_memories (layer, is_active);

CREATE TRIGGER fenn_memories_set_updated_at
  BEFORE UPDATE ON public.fenn_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.fenn_memories IS
  'Durable shared memory for Camp/@askfenn. Canon and approved Greenwood Memory only. No embeddings yet.';

-- ---------------------------------------------------------------------------
-- memory_candidates (never auto-promoted)
-- ---------------------------------------------------------------------------
CREATE TABLE public.memory_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  character_id uuid REFERENCES public.camp_characters (id) ON DELETE SET NULL,
  camp_message_id uuid REFERENCES public.camp_messages (id) ON DELETE SET NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by_actor_id text,
  resulting_memory_id uuid REFERENCES public.fenn_memories (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT memory_candidates_status_check
    CHECK (status IN ('pending', 'approved', 'discarded')),
  CONSTRAINT memory_candidates_content_nonempty
    CHECK (length(trim(content)) > 0)
);

-- Wire optional reverse link from memories to candidates (created after both tables exist).
ALTER TABLE public.fenn_memories
  ADD CONSTRAINT fenn_memories_source_candidate_id_fkey
  FOREIGN KEY (source_candidate_id)
  REFERENCES public.memory_candidates (id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX memory_candidates_camp_message_uidx
  ON public.memory_candidates (camp_message_id)
  WHERE camp_message_id IS NOT NULL;

CREATE INDEX memory_candidates_moderation_queue_idx
  ON public.memory_candidates (status, created_at)
  WHERE status = 'pending';

CREATE TRIGGER memory_candidates_set_updated_at
  BEFORE UPDATE ON public.memory_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.memory_candidates IS
  'Camp-flagged memory proposals. Must be moderated; never auto-enter fenn_memories.';
