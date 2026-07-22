-- FENN Stage 2 — Migration 05: Deeds & submissions
-- LOCAL ONLY — do not apply until explicitly authorised.

-- ---------------------------------------------------------------------------
-- deeds
-- ---------------------------------------------------------------------------
CREATE TABLE public.deeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text,
  title text NOT NULL,
  lore_description text NOT NULL,
  instructions text NOT NULL,
  category text,
  access_scope text NOT NULL DEFAULT 'road',
  status text NOT NULL DEFAULT 'draft',
  reward_leaf_fixed integer,
  reward_leaf_min integer,
  reward_leaf_max integer,
  evidence_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  max_completions integer,
  completions_count integer NOT NULL DEFAULT 0,
  is_public boolean NOT NULL DEFAULT true,
  -- false = at most one approved completion per profile
  is_repeatable boolean NOT NULL DEFAULT false,
  -- Future sponsored Deed compatibility (FK added after treasury_contributions exists).
  sponsor_name text,
  sponsor_contribution_id uuid,
  external_reward_note text,
  -- Future Common Deed compatibility (not implemented as product yet).
  common_target_count integer,
  common_progress_count integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT deeds_title_nonempty
    CHECK (length(trim(title)) > 0),
  CONSTRAINT deeds_access_scope_check
    CHECK (access_scope IN ('road', 'greenwood', 'common')),
  CONSTRAINT deeds_status_check
    CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  CONSTRAINT deeds_reward_shape_check
    CHECK (
      (
        reward_leaf_fixed IS NOT NULL
        AND reward_leaf_min IS NULL
        AND reward_leaf_max IS NULL
        AND reward_leaf_fixed >= 0
      )
      OR (
        reward_leaf_fixed IS NULL
        AND reward_leaf_min IS NOT NULL
        AND reward_leaf_max IS NOT NULL
        AND reward_leaf_min >= 0
        AND reward_leaf_max >= reward_leaf_min
      )
      OR (
        reward_leaf_fixed IS NULL
        AND reward_leaf_min IS NULL
        AND reward_leaf_max IS NULL
      )
    ),
  CONSTRAINT deeds_max_completions_positive
    CHECK (max_completions IS NULL OR max_completions > 0),
  CONSTRAINT deeds_completions_count_nonnegative
    CHECK (completions_count >= 0),
  CONSTRAINT deeds_common_target_positive
    CHECK (common_target_count IS NULL OR common_target_count > 0),
  CONSTRAINT deeds_common_progress_nonnegative
    CHECK (common_progress_count >= 0),
  CONSTRAINT deeds_time_range_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);

CREATE UNIQUE INDEX deeds_slug_uidx
  ON public.deeds (slug)
  WHERE slug IS NOT NULL;

CREATE INDEX deeds_listing_idx
  ON public.deeds (status, access_scope, starts_at);

CREATE INDEX deeds_active_public_idx
  ON public.deeds (published_at DESC NULLS LAST)
  WHERE status = 'active' AND is_public = true;

CREATE TRIGGER deeds_set_updated_at
  BEFORE UPDATE ON public.deeds
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.deeds IS
  'Deed definitions. is_repeatable controls approved-completion uniqueness per profile.';

-- ---------------------------------------------------------------------------
-- deed_submissions
-- ---------------------------------------------------------------------------
CREATE TABLE public.deed_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deed_id uuid NOT NULL REFERENCES public.deeds (id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  evidence_text text,
  evidence_url text,
  evidence_image_path text,
  evidence_other text,
  submitted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by_actor_id text,
  review_note text,
  leaf_awarded integer,
  leaf_ledger_id uuid REFERENCES public.leaf_ledger (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT deed_submissions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT deed_submissions_leaf_awarded_nonnegative
    CHECK (leaf_awarded IS NULL OR leaf_awarded >= 0),
  CONSTRAINT deed_submissions_evidence_present
    CHECK (
      evidence_text IS NOT NULL
      OR evidence_url IS NOT NULL
      OR evidence_image_path IS NOT NULL
      OR evidence_other IS NOT NULL
    )
);

-- At most one simultaneous pending submission per profile per Deed.
-- Rejected rows remain; a later resubmission may create a new pending row.
CREATE UNIQUE INDEX deed_submissions_one_pending_per_profile_deed_uidx
  ON public.deed_submissions (deed_id, profile_id)
  WHERE status = 'pending';

-- Approved uniqueness for non-repeatable Deeds cannot be a partial unique index
-- alone (it cannot see deeds.is_repeatable). Enforce via trigger below.
CREATE OR REPLACE FUNCTION public.enforce_deed_submission_approval_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deed_repeatable boolean;
  existing_approved integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT d.is_repeatable
  INTO deed_repeatable
  FROM public.deeds d
  WHERE d.id = NEW.deed_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deed_submissions: deed % not found', NEW.deed_id;
  END IF;

  IF deed_repeatable THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer
  INTO existing_approved
  FROM public.deed_submissions s
  WHERE s.deed_id = NEW.deed_id
    AND s.profile_id = NEW.profile_id
    AND s.status = 'approved'
    AND s.id IS DISTINCT FROM NEW.id;

  IF existing_approved > 0 THEN
    RAISE EXCEPTION
      'deed_submissions: profile % already has an approved completion for non-repeatable deed %',
      NEW.profile_id,
      NEW.deed_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER deed_submissions_enforce_approval_uniqueness
  BEFORE INSERT OR UPDATE OF status, deed_id, profile_id
  ON public.deed_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_deed_submission_approval_uniqueness();

CREATE INDEX deed_submissions_moderation_queue_idx
  ON public.deed_submissions (status, submitted_at)
  WHERE status = 'pending';

CREATE INDEX deed_submissions_profile_history_idx
  ON public.deed_submissions (profile_id, submitted_at DESC);

CREATE INDEX deed_submissions_deed_status_idx
  ON public.deed_submissions (deed_id, status);

CREATE TRIGGER deed_submissions_set_updated_at
  BEFORE UPDATE ON public.deed_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.deed_submissions IS
  'Deed evidence submissions. Rejected rows are preserved; resubmission creates a new pending row.';
COMMENT ON FUNCTION public.enforce_deed_submission_approval_uniqueness() IS
  'For non-repeatable Deeds, blocks a second approved submission per profile.';
