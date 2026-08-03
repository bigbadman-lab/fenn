-- FENN Living Greenwood 6.1 — THE EDITORIAL ROOM
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Desk operator drafts for daily X transmissions. No automatic posting.
-- Service-role access only after requireFennDeskAccess in application code.
-- Never stores private keys, wallets of members, or private messages.

-- ---------------------------------------------------------------------------
-- editorial_runs — one generation session for a UTC covered day
-- ---------------------------------------------------------------------------
CREATE TABLE public.editorial_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  covered_date date NOT NULL,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'archived')),
  -- Operator-safe factual summary (no wallets, emails, conversation bodies)
  world_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  robinhood_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  editorial_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_version text NOT NULL,
  generator_version text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_runs_prompt_version_nonempty
    CHECK (char_length(trim(prompt_version)) > 0),
  CONSTRAINT editorial_runs_generator_version_nonempty
    CHECK (char_length(trim(generator_version)) > 0),
  CONSTRAINT editorial_runs_created_by_nonempty
    CHECK (char_length(trim(created_by)) > 0)
);

CREATE INDEX editorial_runs_covered_date_idx
  ON public.editorial_runs (covered_date DESC, created_at DESC);

COMMENT ON TABLE public.editorial_runs IS
  'Desk Editorial Room generation sessions. One package of 24 draft transmissions per run.';

-- ---------------------------------------------------------------------------
-- editorial_transmissions — 24 drafts per run
-- ---------------------------------------------------------------------------
CREATE TABLE public.editorial_transmissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.editorial_runs (id) ON DELETE CASCADE,
  slot_index smallint NOT NULL
    CHECK (slot_index >= 0 AND slot_index < 24),
  category text NOT NULL
    CHECK (category IN (
      'world_transmission',
      'lore',
      'robinhood_echo',
      'ascii',
      'invitation',
      'founder_note'
    )),
  title text NOT NULL,
  body text NOT NULL,
  edited_body text,
  operator_rationale text NOT NULL DEFAULT '',
  source_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  approval_state text NOT NULL DEFAULT 'draft'
    CHECK (approval_state IN ('draft', 'approved')),
  copy_count integer NOT NULL DEFAULT 0
    CHECK (copy_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_transmissions_title_nonempty
    CHECK (char_length(trim(title)) > 0),
  CONSTRAINT editorial_transmissions_body_nonempty
    CHECK (char_length(trim(body)) > 0),
  CONSTRAINT editorial_transmissions_slot_unique
    UNIQUE (run_id, slot_index)
);

CREATE INDEX editorial_transmissions_run_id_idx
  ON public.editorial_transmissions (run_id, slot_index);

CREATE INDEX editorial_transmissions_approval_idx
  ON public.editorial_transmissions (run_id, approval_state);

COMMENT ON TABLE public.editorial_transmissions IS
  'Draft transmissions for operator review. body is model draft; edited_body is operator edit. No auto-posting.';

COMMENT ON COLUMN public.editorial_transmissions.body IS
  'Original generated body for X. Never post automatically.';

COMMENT ON COLUMN public.editorial_transmissions.edited_body IS
  'Operator override of body. Effective post text prefers this when set.';

CREATE OR REPLACE FUNCTION public.editorial_transmissions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER editorial_transmissions_set_updated_at
  BEFORE UPDATE ON public.editorial_transmissions
  FOR EACH ROW
  EXECUTE FUNCTION public.editorial_transmissions_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — no browser grants; service_role only after Desk auth in app
-- ---------------------------------------------------------------------------
ALTER TABLE public.editorial_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_transmissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.editorial_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.editorial_transmissions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.editorial_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.editorial_transmissions TO service_role;
