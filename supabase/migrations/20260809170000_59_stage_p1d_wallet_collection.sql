-- Stage P1D — conversational wallet collection for pending transfer
-- LOCAL ONLY — apply when authorised.
-- Holds a multi-turn wallet confirmation FSM for transfer_fenn only.
-- Not permanent X↔wallet identity. Not public. Service-role only.

CREATE TABLE public.x_economic_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Immutable X security identity (username is never principal).
  author_x_user_id text NOT NULL,

  -- Origin judgement that decided transfer + amount.
  source_x_post_id text NOT NULL,
  origin_perception_event_id uuid
    REFERENCES public.x_perception_events (id) ON DELETE RESTRICT,
  origin_judgement_id uuid
    REFERENCES public.x_perception_judgements (id) ON DELETE SET NULL,
  x_conversation_id text,

  -- Frozen economic decision (never mutated during wallet collection).
  economic_action_type text NOT NULL,
  proposed_amount text NOT NULL,
  economic_reason text NOT NULL,

  status text NOT NULL DEFAULT 'awaiting_wallet',

  candidate_wallet text,
  confirmed_wallet text,
  candidate_source_x_post_id text,
  confirmation_source_x_post_id text,

  -- At most one transfer effect for this interaction.
  transfer_effect_id uuid UNIQUE,
  last_error text,

  wallet_requested_at timestamptz,
  wallet_received_at timestamptz,
  wallet_confirmation_requested_at timestamptz,
  wallet_confirmed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT x_economic_interactions_author_nonempty
    CHECK (length(trim(author_x_user_id)) > 0),
  CONSTRAINT x_economic_interactions_source_post_nonempty
    CHECK (length(trim(source_x_post_id)) > 0),
  CONSTRAINT x_economic_interactions_action_transfer_only
    CHECK (economic_action_type = 'transfer_fenn'),
  CONSTRAINT x_economic_interactions_amount_nonempty
    CHECK (length(trim(proposed_amount)) > 0),
  CONSTRAINT x_economic_interactions_reason_nonempty
    CHECK (length(trim(economic_reason)) > 0),
  CONSTRAINT x_economic_interactions_status_check
    CHECK (status IN (
      'awaiting_wallet',
      'awaiting_wallet_confirmation',
      'wallet_confirmed',
      'executing',
      'completed',
      'cancelled',
      'expired',
      'failed'
    )),
  CONSTRAINT x_economic_interactions_candidate_normalized
    CHECK (
      candidate_wallet IS NULL
      OR public.is_normalized_evm_address(candidate_wallet)
    ),
  CONSTRAINT x_economic_interactions_confirmed_normalized
    CHECK (
      confirmed_wallet IS NULL
      OR public.is_normalized_evm_address(confirmed_wallet)
    )
);

CREATE TRIGGER x_economic_interactions_set_updated_at
  BEFORE UPDATE ON public.x_economic_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- MVP: at most one active wallet-requiring interaction per immutable X user.
CREATE UNIQUE INDEX x_economic_interactions_one_active_per_author_uidx
  ON public.x_economic_interactions (author_x_user_id)
  WHERE status IN (
    'awaiting_wallet',
    'awaiting_wallet_confirmation',
    'wallet_confirmed',
    'executing'
  );

CREATE INDEX x_economic_interactions_author_status_idx
  ON public.x_economic_interactions (author_x_user_id, status);

CREATE INDEX x_economic_interactions_expires_idx
  ON public.x_economic_interactions (expires_at)
  WHERE status IN (
    'awaiting_wallet',
    'awaiting_wallet_confirmation',
    'wallet_confirmed',
    'executing'
  );

COMMENT ON TABLE public.x_economic_interactions IS
  'Stage P1D: pending transfer destination collection. Trust is limited to this interaction; never permanent X→wallet identity. Service-role only.';

COMMENT ON COLUMN public.x_economic_interactions.author_x_user_id IS
  'Immutable X author user id (text). Handle changes do not alter identity.';

COMMENT ON COLUMN public.x_economic_interactions.proposed_amount IS
  'Frozen FENN-proposed amount (decimal string). Never mutated by user requests during collection.';

COMMENT ON COLUMN public.x_economic_interactions.confirmed_wallet IS
  'Destination confirmed by the same X user for this interaction only. Not profile ownership.';

ALTER TABLE public.x_economic_interactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.x_economic_interactions FROM PUBLIC;
REVOKE ALL ON TABLE public.x_economic_interactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.x_economic_interactions TO service_role;

-- Policy code for destination-pending path
ALTER TABLE public.x_perception_authorizations
  DROP CONSTRAINT IF EXISTS x_perception_authorizations_policy_code_check;

ALTER TABLE public.x_perception_authorizations
  ADD CONSTRAINT x_perception_authorizations_policy_code_check
  CHECK (policy_code IN (
    'permitted_reply',
    'permitted_wall',
    'permitted_reply_and_wall',
    'permitted_transfer_p1a',
    'permitted_burn_p1a',
    'permitted_transfer_p1b',
    'permitted_burn_p1b',
    'permitted_reply_and_economic',
    'pending_destination',
    'no_action',
    'invalid_final_judgement',
    'missing_reply_candidate',
    'missing_wall_candidate',
    'invalid_candidate',
    'event_not_eligible',
    'already_authorised',
    'judgement_failed',
    'wall_requires_reply',
    'reply_generation_failed'
  ));
