-- Stage P1C — economic magnitude notes (LOCAL ONLY)
-- final_economic_intent may now include proposedAmount (decimal string).
-- Authority limits are env-configured application constants, not DB rows.
-- No schema shape change required for jsonb; comment update only.

COMMENT ON COLUMN public.x_perception_judgements.final_economic_intent IS
  'Stage P1B/P1C: model economic intention {type:NONE|transfer_fenn|burn_fenn, proposedAmount?, reason?, recipientSource?}. Never keys/token/chain/recipient address/rail. proposedAmount is model magnitude judgement (decimal string).';
