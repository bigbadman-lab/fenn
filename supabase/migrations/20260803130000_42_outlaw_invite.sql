-- FENN — Outlaw Invite (one-level invite + LEAF reward)
-- LOCAL ONLY — do not apply until explicitly authorised.
--
-- Registered Outlaws share a unique invite link. When a genuinely new profile
-- completes registration through that link, the inviter may receive 5 LEAF
-- (up to 10 rewarded invites / 50 LEAF). Automatic; no Desk approval.

-- ---------------------------------------------------------------------------
-- LEAF ledger: add invite source type
-- ---------------------------------------------------------------------------
ALTER TABLE public.leaf_ledger
  DROP CONSTRAINT leaf_ledger_source_type_check;

ALTER TABLE public.leaf_ledger
  ADD CONSTRAINT leaf_ledger_source_type_check
  CHECK (
    source_type IN (
      'camp',
      'deed',
      'admin_adjustment',
      'system',
      'hollow',
      'onboarding',
      'invite'
    )
  );

-- ---------------------------------------------------------------------------
-- Invite code generation (URL-safe, non-sequential, not identity-derived)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_outlaw_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  result text := '';
  i integer;
  idx integer;
BEGIN
  FOR i IN 1..12 LOOP
    idx := 1 + floor(random() * length(alphabet))::integer;
    result := result || substr(alphabet, idx, 1);
  END LOOP;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.generate_outlaw_invite_code() IS
  'Generate a short URL-safe invite code. Not derived from wallet, email, Privy id, or profile UUID.';

-- ---------------------------------------------------------------------------
-- profiles.invite_code (durable, unique, backfilled)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_code text;

-- Backfill existing rows with unique codes (unique index created after this block)
DO $$
DECLARE
  r record;
  v_code text;
  v_attempts integer;
BEGIN
  FOR r IN
    SELECT id
    FROM public.profiles
    WHERE invite_code IS NULL OR length(trim(invite_code)) = 0
    ORDER BY outlaw_number
  LOOP
    v_attempts := 0;
    LOOP
      v_code := public.generate_outlaw_invite_code();
      v_attempts := v_attempts + 1;
      IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.invite_code = v_code
      ) THEN
        UPDATE public.profiles
        SET invite_code = v_code
        WHERE id = r.id;
        EXIT;
      END IF;
      IF v_attempts >= 32 THEN
        RAISE EXCEPTION
          'FENN_INVITE_CODE_COLLISION: failed to backfill invite_code for %',
          r.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN invite_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code_uidx
  ON public.profiles (invite_code);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_invite_code_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_invite_code_format
  CHECK (invite_code ~ '^[A-Za-z0-9]{8,32}$');

COMMENT ON COLUMN public.profiles.invite_code IS
  'Stable public invite token for one-level Outlaw invites. Server-generated; not member-editable.';

-- Ensure new profiles always receive an invite code
CREATE OR REPLACE FUNCTION public.profiles_set_invite_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_attempts integer := 0;
BEGIN
  IF NEW.invite_code IS NOT NULL AND length(trim(NEW.invite_code)) > 0 THEN
    RETURN NEW;
  END IF;

  LOOP
    v_code := public.generate_outlaw_invite_code();
    v_attempts := v_attempts + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.invite_code = v_code
    ) THEN
      NEW.invite_code := v_code;
      RETURN NEW;
    END IF;
    IF v_attempts >= 32 THEN
      RAISE EXCEPTION 'FENN_INVITE_CODE_COLLISION: could not allocate invite_code';
    END IF;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_invite_code_before_insert ON public.profiles;
CREATE TRIGGER profiles_set_invite_code_before_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_set_invite_code();

-- Block member-facing changes to invite_code (service_role still uses this path carefully)
CREATE OR REPLACE FUNCTION public.profiles_protect_invite_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
    RAISE EXCEPTION 'FENN_INVITE_CODE_IMMUTABLE: invite_code cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_invite_code_before_update ON public.profiles;
CREATE TRIGGER profiles_protect_invite_code_before_update
  BEFORE UPDATE OF invite_code ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_invite_code();

-- ---------------------------------------------------------------------------
-- outlaw_invites — one attribution per invited profile
-- ---------------------------------------------------------------------------
CREATE TABLE public.outlaw_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  invited_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  invite_code text NOT NULL,
  status text NOT NULL,
  reward_amount integer NOT NULL DEFAULT 0,
  rewarded_at timestamptz,
  leaf_ledger_id uuid REFERENCES public.leaf_ledger (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT outlaw_invites_invited_profile_uidx
    UNIQUE (invited_profile_id),
  CONSTRAINT outlaw_invites_self_invite_check
    CHECK (inviter_profile_id <> invited_profile_id),
  CONSTRAINT outlaw_invites_status_check
    CHECK (status IN ('registered', 'rewarded', 'cap_reached', 'rejected')),
  CONSTRAINT outlaw_invites_reward_amount_check
    CHECK (reward_amount IN (0, 5)),
  CONSTRAINT outlaw_invites_rewarded_consistency
    CHECK (
      (status = 'rewarded' AND reward_amount = 5 AND rewarded_at IS NOT NULL AND leaf_ledger_id IS NOT NULL)
      OR (status = 'cap_reached' AND reward_amount = 0 AND leaf_ledger_id IS NULL)
      OR (status = 'registered' AND reward_amount = 0 AND leaf_ledger_id IS NULL)
      OR (status = 'rejected' AND reward_amount = 0 AND leaf_ledger_id IS NULL)
    )
);

CREATE UNIQUE INDEX outlaw_invites_leaf_ledger_uidx
  ON public.outlaw_invites (leaf_ledger_id)
  WHERE leaf_ledger_id IS NOT NULL;

CREATE INDEX outlaw_invites_inviter_created_idx
  ON public.outlaw_invites (inviter_profile_id, created_at DESC);

CREATE INDEX outlaw_invites_inviter_rewarded_idx
  ON public.outlaw_invites (inviter_profile_id)
  WHERE status = 'rewarded';

CREATE TRIGGER outlaw_invites_set_updated_at
  BEFORE UPDATE ON public.outlaw_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.outlaw_invites IS
  'One-level Outlaw invite attribution. One inviter per invited profile. Rewards via service-role RPC only.';

ALTER TABLE public.outlaw_invites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.outlaw_invites FROM PUBLIC;
REVOKE ALL ON TABLE public.outlaw_invites FROM anon;
REVOKE ALL ON TABLE public.outlaw_invites FROM authenticated;
GRANT ALL ON TABLE public.outlaw_invites TO service_role;
GRANT ALL ON TABLE public.outlaw_invites TO postgres;

-- ---------------------------------------------------------------------------
-- Pending retry after registration if invite RPC fails
-- ---------------------------------------------------------------------------
CREATE TABLE public.outlaw_invite_retries (
  invited_profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  invite_code text NOT NULL,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT outlaw_invite_retries_code_format
    CHECK (invite_code ~ '^[A-Za-z0-9]{8,32}$')
);

CREATE TRIGGER outlaw_invite_retries_set_updated_at
  BEFORE UPDATE ON public.outlaw_invite_retries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.outlaw_invite_retries IS
  'Durable invite retry queue written only when registration succeeded but invite RPC failed.';

ALTER TABLE public.outlaw_invite_retries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.outlaw_invite_retries FROM PUBLIC;
REVOKE ALL ON TABLE public.outlaw_invite_retries FROM anon;
REVOKE ALL ON TABLE public.outlaw_invite_retries FROM authenticated;
GRANT ALL ON TABLE public.outlaw_invite_retries TO service_role;
GRANT ALL ON TABLE public.outlaw_invite_retries TO postgres;

-- ---------------------------------------------------------------------------
-- Atomic register_outlaw_invite
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_outlaw_invite(
  p_invite_code text,
  p_invited_profile_id uuid
)
RETURNS TABLE (
  outcome text,
  invite_id uuid,
  inviter_profile_id uuid,
  rewarded boolean,
  reward_amount integer,
  rewarded_invite_number integer,
  leaf_ledger_id uuid,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_code text;
  v_invited public.profiles%ROWTYPE;
  v_inviter public.profiles%ROWTYPE;
  v_existing public.outlaw_invites%ROWTYPE;
  v_invite public.outlaw_invites%ROWTYPE;
  v_rewarded_count integer;
  v_next_number integer;
  v_key text;
  v_ledger public.leaf_ledger%ROWTYPE;
  v_ft public.first_thirty_progress%ROWTYPE;
  v_lifetime bigint;
  v_threshold integer;
  v_is_greenwood boolean;
  v_now timestamptz := timezone('utc', now());
  c_reward integer := 5;
  c_cap integer := 10;
BEGIN
  IF p_invited_profile_id IS NULL THEN
    RAISE EXCEPTION 'FENN_VALIDATION: invited_profile_id required'
      USING ERRCODE = '22023';
  END IF;

  v_code := trim(COALESCE(p_invite_code, ''));
  IF v_code = '' OR v_code !~ '^[A-Za-z0-9]{8,32}$' THEN
    outcome := 'invalid_code';
    invite_id := NULL;
    inviter_profile_id := NULL;
    rewarded := false;
    reward_amount := 0;
    rewarded_invite_number := NULL;
    leaf_ledger_id := NULL;
    status := 'rejected';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock invited profile first
  SELECT *
  INTO v_invited
  FROM public.profiles p
  WHERE p.id = p_invited_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FENN_PROFILE_NOT_FOUND: invited profile missing'
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent if already attributed
  SELECT *
  INTO v_existing
  FROM public.outlaw_invites i
  WHERE i.invited_profile_id = p_invited_profile_id
  FOR UPDATE;

  IF FOUND THEN
    outcome := 'already_attributed';
    invite_id := v_existing.id;
    inviter_profile_id := v_existing.inviter_profile_id;
    rewarded := (v_existing.status = 'rewarded');
    reward_amount := v_existing.reward_amount;
    rewarded_invite_number := NULL;
    leaf_ledger_id := v_existing.leaf_ledger_id;
    status := v_existing.status;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Resolve inviter by invite code (must be registered profile)
  SELECT *
  INTO v_inviter
  FROM public.profiles p
  WHERE p.invite_code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'invalid_code';
    invite_id := NULL;
    inviter_profile_id := NULL;
    rewarded := false;
    reward_amount := 0;
    rewarded_invite_number := NULL;
    leaf_ledger_id := NULL;
    status := 'rejected';

    INSERT INTO public.admin_audit_log (
      actor_id, actor_type, action, entity_type, entity_id, after_state
    ) VALUES (
      'outlaw_invite',
      'system',
      'outlaw_invite.rejected_invalid_code',
      'profile',
      p_invited_profile_id::text,
      jsonb_build_object('inviteCodePresent', true)
    );

    RETURN NEXT;
    RETURN;
  END IF;

  -- Self-invite
  IF v_inviter.id = v_invited.id THEN
    outcome := 'rejected_self';
    invite_id := NULL;
    inviter_profile_id := v_inviter.id;
    rewarded := false;
    reward_amount := 0;
    rewarded_invite_number := NULL;
    leaf_ledger_id := NULL;
    status := 'rejected';

    INSERT INTO public.admin_audit_log (
      actor_id, actor_type, action, entity_type, entity_id, after_state
    ) VALUES (
      'outlaw_invite',
      'system',
      'outlaw_invite.rejected_self',
      'profile',
      p_invited_profile_id::text,
      jsonb_build_object('inviterProfileId', v_inviter.id)
    );

    RETURN NEXT;
    RETURN;
  END IF;

  -- Serialize rewards per inviter so concurrent arrivals cannot exceed cap
  PERFORM pg_advisory_xact_lock(
    hashtextextended('outlaw_invite:' || v_inviter.id::text, 2)
  );

  SELECT count(*)::integer
  INTO v_rewarded_count
  FROM public.outlaw_invites i
  WHERE i.inviter_profile_id = v_inviter.id
    AND i.status = 'rewarded';

  v_key := 'outlaw_invite:' || p_invited_profile_id::text || ':reward';

  IF v_rewarded_count >= c_cap THEN
    INSERT INTO public.outlaw_invites (
      inviter_profile_id,
      invited_profile_id,
      invite_code,
      status,
      reward_amount,
      rewarded_at,
      leaf_ledger_id
    ) VALUES (
      v_inviter.id,
      v_invited.id,
      v_code,
      'cap_reached',
      0,
      NULL,
      NULL
    )
    RETURNING * INTO v_invite;

    INSERT INTO public.admin_audit_log (
      actor_id, actor_type, action, entity_type, entity_id, after_state
    ) VALUES (
      'outlaw_invite',
      'system',
      'outlaw_invite.cap_reached',
      'outlaw_invite',
      v_invite.id::text,
      jsonb_build_object(
        'inviterProfileId', v_inviter.id,
        'invitedProfileId', v_invited.id,
        'rewardAmount', 0,
        'rewardedCount', v_rewarded_count,
        'cap', c_cap
      )
    );

    outcome := 'cap_reached';
    invite_id := v_invite.id;
    inviter_profile_id := v_inviter.id;
    rewarded := false;
    reward_amount := 0;
    rewarded_invite_number := NULL;
    leaf_ledger_id := NULL;
    status := 'cap_reached';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Cap not reached — award under exclusive ledger idempotency
  SELECT *
  INTO v_ledger
  FROM public.leaf_ledger l
  WHERE l.idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    -- Ledger exists (partial prior attempt): recover invite row
    INSERT INTO public.outlaw_invites (
      inviter_profile_id,
      invited_profile_id,
      invite_code,
      status,
      reward_amount,
      rewarded_at,
      leaf_ledger_id
    ) VALUES (
      v_inviter.id,
      v_invited.id,
      v_code,
      'rewarded',
      c_reward,
      COALESCE(v_ledger.created_at, v_now),
      v_ledger.id
    )
    ON CONFLICT (invited_profile_id) DO UPDATE
      SET
        status = 'rewarded',
        reward_amount = c_reward,
        rewarded_at = COALESCE(public.outlaw_invites.rewarded_at, EXCLUDED.rewarded_at),
        leaf_ledger_id = COALESCE(public.outlaw_invites.leaf_ledger_id, EXCLUDED.leaf_ledger_id)
    RETURNING * INTO v_invite;

    outcome := 'already_rewarded';
    invite_id := v_invite.id;
    inviter_profile_id := v_inviter.id;
    rewarded := true;
    reward_amount := c_reward;
    rewarded_invite_number := v_rewarded_count; -- approximate on recovery
    leaf_ledger_id := v_ledger.id;
    status := 'rewarded';
    RETURN NEXT;
    RETURN;
  END IF;

  v_next_number := v_rewarded_count + 1;

  INSERT INTO public.leaf_ledger (
    profile_id,
    wallet_address,
    amount,
    lifetime_delta,
    source_type,
    source_id,
    secondary_source_id,
    reason,
    actor_type,
    actor_id,
    idempotency_key,
    metadata
  ) VALUES (
    v_inviter.id,
    v_inviter.wallet_address,
    c_reward,
    c_reward,
    'invite',
    p_invited_profile_id::text,
    NULL,
    'Outlaw invite arrival',
    'system',
    'outlaw_invite',
    v_key,
    jsonb_build_object(
      'inviteReward', true,
      'rewardedInviteNumber', v_next_number,
      'cap', c_cap
    )
  )
  RETURNING * INTO v_ledger;

  INSERT INTO public.outlaw_invites (
    inviter_profile_id,
    invited_profile_id,
    invite_code,
    status,
    reward_amount,
    rewarded_at,
    leaf_ledger_id
  ) VALUES (
    v_inviter.id,
    v_invited.id,
    v_code,
    'rewarded',
    c_reward,
    v_now,
    v_ledger.id
  )
  RETURNING * INTO v_invite;

  -- First Thirty: invite LEAF counts toward lifetime; close inviter path if threshold met
  SELECT *
  INTO v_ft
  FROM public.first_thirty_progress ft
  WHERE ft.profile_id = v_inviter.id
  FOR UPDATE;

  IF FOUND AND v_ft.status = 'active' THEN
    v_lifetime := public.first_thirty_lifetime_leaf(v_inviter.id);
    v_threshold := public.first_thirty_greenwood_threshold();
    v_is_greenwood := v_inviter.greenwood_entered_at IS NOT NULL;
    PERFORM public.first_thirty_close_if_needed(
      v_ft,
      v_lifetime,
      v_threshold,
      v_is_greenwood
    );
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id, actor_type, action, entity_type, entity_id, after_state
  ) VALUES (
    'outlaw_invite',
    'system',
    'outlaw_invite.rewarded',
    'outlaw_invite',
    v_invite.id::text,
    jsonb_build_object(
      'inviterProfileId', v_inviter.id,
      'invitedProfileId', v_invited.id,
      'rewardAmount', c_reward,
      'rewardedInviteNumber', v_next_number,
      'cap', c_cap,
      'leafLedgerId', v_ledger.id
    )
  );

  INSERT INTO public.admin_audit_log (
    actor_id, actor_type, action, entity_type, entity_id, after_state
  ) VALUES (
    'outlaw_invite',
    'system',
    'outlaw_invite.registered',
    'outlaw_invite',
    v_invite.id::text,
    jsonb_build_object(
      'inviterProfileId', v_inviter.id,
      'invitedProfileId', v_invited.id,
      'status', 'rewarded'
    )
  );

  outcome := 'rewarded';
  invite_id := v_invite.id;
  inviter_profile_id := v_inviter.id;
  rewarded := true;
  reward_amount := c_reward;
  rewarded_invite_number := v_next_number;
  leaf_ledger_id := v_ledger.id;
  status := 'rewarded';
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.register_outlaw_invite(text, uuid) IS
  'Atomic one-level Outlaw invite attribution + optional LEAF reward. Service-role only. Idempotent on invited profile.';

REVOKE ALL ON FUNCTION public.register_outlaw_invite(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_outlaw_invite(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.register_outlaw_invite(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_outlaw_invite(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_outlaw_invite(text, uuid) TO postgres;

-- First Thirty helpers used by invite reward close path
GRANT EXECUTE ON FUNCTION public.first_thirty_close_if_needed(
  public.first_thirty_progress, bigint, integer, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.first_thirty_greenwood_threshold() TO service_role;
GRANT EXECUTE ON FUNCTION public.first_thirty_lifetime_leaf(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Public-safe invite code validation (returns no private fields)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_outlaw_invite_code(
  p_invite_code text
)
RETURNS TABLE (
  valid boolean,
  inviter_outlaw_number bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_number bigint;
BEGIN
  v_code := trim(COALESCE(p_invite_code, ''));
  IF v_code = '' OR v_code !~ '^[A-Za-z0-9]{8,32}$' THEN
    valid := false;
    inviter_outlaw_number := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT p.outlaw_number
  INTO v_number
  FROM public.profiles p
  WHERE p.invite_code = v_code
    AND p.is_active = true
  LIMIT 1;

  IF FOUND THEN
    valid := true;
    inviter_outlaw_number := v_number;
  ELSE
    valid := false;
    inviter_outlaw_number := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.lookup_outlaw_invite_code(text) IS
  'Public-safe invite code validation. Returns only validity + safe outlaw number. Service-role only.';

REVOKE ALL ON FUNCTION public.lookup_outlaw_invite_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_outlaw_invite_code(text) FROM anon;
REVOKE ALL ON FUNCTION public.lookup_outlaw_invite_code(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_outlaw_invite_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lookup_outlaw_invite_code(text) TO postgres;
