# Stage P1B — Economic judgement (fixed 1 FENN)

## Summary

FENN may **propose** economic intent during Stage 12.4 final judgement:

- `economicAction: NONE` (preferred / common)
- `transfer_fenn` with `recipientSource: trusted_profile_wallet` + `reason`
- `burn_fenn` with `reason`

**Code owns consequences.** Amount is always `"1"`. Model never sets token, chain, calldata, dead address, or rail.

## Limitation (critical)

There is **no durable live mapping** from X author identity (`author_x_user_id`) → `profiles.wallet_address`.

Therefore:

| Path | Transfer recipients |
|------|---------------------|
| Ordinary live X | Transfer effects not planned (no trusted wallet) |
| Controlled P1B harness | Operator may bind `--trusted-wallet` |

Burns can still be planned in live when Purse + official FENN + authority gates allow; transfers need a trusted wallet binding.

## Flow

```
final judge (constitution + purse state)
  → final_economic_intent jsonb
  → Stage 12.5 authority (planEconomicEffects)
  → transfer_fenn | burn_fenn | none (+ speech effects)
  → Stage 12.6 execute (existing Purse adapters)
  → optional economicFollowupPreview after confirmed tx
```

## Execution rails

| Mode | Rail |
|------|------|
| Ordinary live authorize | `official` only |
| P1B harness | `p1a_test` only when `testRailExplicitlyActive` |
| Missing official FENN on live | economic effects refused; speech continues |

## Controlled test

```bash
npm run agent:test-economic-judgement -- \
  --text "something thoughtful" \
  --operation-label p1b-001 \
  --dry-run

npm run agent:test-economic-judgement -- \
  --text "..." \
  --operation-label p1b-burn \
  --intent burn \
  --dry-run

npm run agent:test-economic-judgement -- \
  --text "..." \
  --operation-label p1b-xfer \
  --trusted-wallet 0x… \
  --intent transfer \
  --dry-run
```

Add `--execute` only for disposable-rail live settlement (requires test envs).

## Migration

`supabase/migrations/20260809150000_57_stage_p1b_economic_judgement.sql`

- `final_economic_intent` column
- `permitted_transfer_p1b` / `permitted_burn_p1b` / `permitted_reply_and_economic`
- Claim + finalize RPC extensions

## Toward P1C

- Durable X → verified wallet mapping
- Post-confirmation follow-up posted as real second reply
- Optional model-generated speech from Book of Speech over trusted economics facts
- Still fixed amount until P2
