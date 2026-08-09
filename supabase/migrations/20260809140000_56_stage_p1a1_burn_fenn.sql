-- Stage P1A.1 — burn_fenn + purse settlement action_type
-- LOCAL ONLY — apply when authorised.
-- burn_fenn = dead-address transfer (not native ERC-20 burn()).
-- does not create purse_burns; reuse purse_transfers.

-- A) Stage 12 effect types
ALTER TABLE public.x_perception_effects
  DROP CONSTRAINT IF EXISTS x_perception_effects_type_check;

ALTER TABLE public.x_perception_effects
  ADD CONSTRAINT x_perception_effects_type_check
  CHECK (effect_type IN (
    'reply_on_x',
    'write_to_wall',
    'transfer_fenn',
    'burn_fenn'
  ));

COMMENT ON COLUMN public.x_perception_effects.effect_type IS
  'reply_on_x | write_to_wall | transfer_fenn | burn_fenn. Never holds keys.';

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

-- B) Settlement classification: transfer vs burn
ALTER TABLE public.purse_transfers
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'transfer';

ALTER TABLE public.purse_transfers
  DROP CONSTRAINT IF EXISTS purse_transfers_action_type_check;

ALTER TABLE public.purse_transfers
  ADD CONSTRAINT purse_transfers_action_type_check
  CHECK (action_type IN ('transfer', 'burn'));

COMMENT ON COLUMN public.purse_transfers.action_type IS
  'transfer = external recipient; burn = canonical dead-address send. Not native token burn().';

-- C) list_pending preview for burn_fenn
CREATE OR REPLACE FUNCTION public.list_pending_x_perception_effects(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  effect_id uuid,
  effect_type text,
  idempotency_key text,
  status text,
  failure_class text,
  attempt_count integer,
  x_post_id text,
  created_at timestamptz,
  payload_preview text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));

  RETURN QUERY
  SELECT
    e.id,
    e.effect_type,
    e.idempotency_key,
    e.status,
    e.failure_class,
    e.attempt_count,
    ev.x_post_id,
    e.created_at,
    CASE
      WHEN e.effect_type = 'reply_on_x' THEN left(coalesce(e.payload->>'text', ''), 80)
      WHEN e.effect_type = 'write_to_wall' THEN left(coalesce(e.payload->>'body', ''), 80)
      WHEN e.effect_type = 'transfer_fenn' THEN left(
        concat(
          coalesce(e.payload->>'executionRail', ''),
          ' ',
          left(coalesce(e.payload->>'recipientAddress', ''), 12),
          ' amount=',
          coalesce(e.payload->>'amountFormatted', '')
        ),
        80
      )
      WHEN e.effect_type = 'burn_fenn' THEN left(
        concat(
          'BURN ',
          coalesce(e.payload->>'executionRail', ''),
          ' amount=',
          coalesce(e.payload->>'amountFormatted', '')
        ),
        80
      )
      ELSE NULL
    END
  FROM public.x_perception_effects e
  JOIN public.x_perception_events ev ON ev.id = e.perception_event_id
  WHERE e.status = 'pending'
     OR (e.status = 'failed' AND e.failure_class = 'retryable')
     OR (e.status = 'failed' AND e.failure_class = 'ambiguous')
  ORDER BY e.created_at ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_pending_x_perception_effects(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_x_perception_effects(integer) TO service_role;
