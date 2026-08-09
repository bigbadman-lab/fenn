-- Stage P1A — transfer_fenn effect type for Stage 12
-- LOCAL ONLY — apply when authorised.
-- Extends x_perception_effects type check so authorized transfer units
-- can be planned/executed. Does not create a second settlement table;
-- purse_transfers remains the chain truth.
-- Model-originated transfers are still NOT planned by live authority.

ALTER TABLE public.x_perception_effects
  DROP CONSTRAINT IF EXISTS x_perception_effects_type_check;

ALTER TABLE public.x_perception_effects
  ADD CONSTRAINT x_perception_effects_type_check
  CHECK (effect_type IN ('reply_on_x', 'write_to_wall', 'transfer_fenn'));

COMMENT ON COLUMN public.x_perception_effects.effect_type IS
  'reply_on_x | write_to_wall | transfer_fenn (P1A). Economic effects never hold keys.';

-- Policy code for controlled P1A scaffolding (not live model planning).
ALTER TABLE public.x_perception_authorizations
  DROP CONSTRAINT IF EXISTS x_perception_authorizations_policy_code_check;

ALTER TABLE public.x_perception_authorizations
  ADD CONSTRAINT x_perception_authorizations_policy_code_check
  CHECK (policy_code IN (
    'permitted_reply',
    'permitted_wall',
    'permitted_reply_and_wall',
    'permitted_transfer_p1a',
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

-- Payload preview for list_pending.
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
