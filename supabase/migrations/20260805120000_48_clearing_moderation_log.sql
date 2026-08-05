-- FENN Clearing 1.0C — moderation audit log
-- LOCAL ONLY — do not apply until explicitly authorised.
-- Desk / service_role only. Never public.

CREATE TABLE public.clearing_moderation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  message_id uuid REFERENCES public.clearing_messages (id) ON DELETE SET NULL,
  traveller_id uuid REFERENCES public.clearing_travellers (id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  target_label text,
  previous_state jsonb,
  next_state jsonb,
  reason text,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  actor_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT clearing_moderation_log_action_nonempty
    CHECK (length(trim(action)) > 0),
  CONSTRAINT clearing_moderation_log_action_max
    CHECK (char_length(action) <= 64),
  CONSTRAINT clearing_moderation_log_target_label_max
    CHECK (target_label IS NULL OR char_length(target_label) <= 120),
  CONSTRAINT clearing_moderation_log_reason_max
    CHECK (reason IS NULL OR char_length(reason) <= 500),
  CONSTRAINT clearing_moderation_log_actor_label_max
    CHECK (char_length(actor_label) <= 120)
);

COMMENT ON TABLE public.clearing_moderation_log IS
  'Desk-only Clearing moderation audit trail. Not publicly readable.';

CREATE INDEX clearing_moderation_log_created_at_idx
  ON public.clearing_moderation_log (created_at DESC);

CREATE INDEX clearing_moderation_log_message_id_idx
  ON public.clearing_moderation_log (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX clearing_moderation_log_traveller_id_idx
  ON public.clearing_moderation_log (traveller_id)
  WHERE traveller_id IS NOT NULL;

CREATE INDEX clearing_moderation_log_profile_id_idx
  ON public.clearing_moderation_log (profile_id)
  WHERE profile_id IS NOT NULL;

ALTER TABLE public.clearing_moderation_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clearing_moderation_log FROM PUBLIC;
REVOKE ALL ON public.clearing_moderation_log FROM anon, authenticated;
GRANT ALL ON public.clearing_moderation_log TO service_role;
