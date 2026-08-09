-- Stage P1E — post-confirmation economic speech + X proof
-- LOCAL ONLY — comment migration documenting the feature boundary.
-- Follow-up reply_on_x effects use existing x_perception_effects with
-- unique idempotency_key: stage12:economic_followup:<economic-effect-id>
-- No new public tables. Service-role only via existing effect RLS.

COMMENT ON TABLE public.x_perception_effects IS
  'Stage 12.5 authorised effects. Stage 12.6 executes. P1E reuses reply_on_x with idempotency stage12:economic_followup:<economic-effect-id> after confirmed Purse settlement. Never browser-accessible.';
