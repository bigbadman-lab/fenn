# Stage P1C — Economic magnitude (MVP foundation)

## Summary

FENN may **propose economic magnitude** during Stage 12.4:

```json
{ "type": "NONE" }
```

or

```json
{
  "type": "transfer_fenn",
  "proposedAmount": "10000",
  "reason": "…",
  "recipientSource": "trusted_profile_wallet"
}
```

or

```json
{
  "type": "burn_fenn",
  "proposedAmount": "50000",
  "reason": "…"
}
```

**Code owns consequences.** Authority may only **permit or refuse** the exact `proposedAmount`. It never clamps, rewrites, or silently reduces FENN’s amount.

## Economic foundation (calibration assumption)

| Reference | Value |
|-----------|-------|
| Total FENN supply (assumption) | 1,000,000,000 |
| Original Purse allocation | 10,000,000 (= 1% of total) |

Scale markers (orientation — **not** reward tiers):

| Amount | Of original Purse |
|--------|-------------------|
| 10,000 | 0.1% |
| 50,000 | 0.5% |
| 100,000 | 1% |
| 500,000 | 5% |
| 1,000,000 | 10% |

~10,000 FENN is rough orientation for “economically noticeable” — **not** a hard minimum.

## Authority envelope (catastrophe protection only)

Three controls (env-overridable):

| Control | Env | TEST default |
|---------|-----|--------------|
| Max single transfer | `FENN_PURSE_MAX_SINGLE_TRANSFER` | `2000000` |
| Max single burn | `FENN_PURSE_MAX_SINGLE_BURN` | `500000` |
| Max rolling 24h outflow | `FENN_PURSE_MAX_ROLLING_24H_OUTFLOW` | `5000000` |

**Recommended production region** (manual decision; not auto-applied):

| Control | Suggested |
|---------|-----------|
| Max single transfer | `100000` (1% of original 10M Purse) |
| Max single burn | `50000` (0.5%) |
| Max rolling 24h | `500000` (5%) |

On limit breach: refuse with `amount_exceeds_transfer_limit` / `amount_exceeds_burn_limit` / `amount_exceeds_rolling_24h_limit`. **Never execute a smaller amount.**

## User-requested amounts

Untrusted. Never parse X text into transaction amounts. The final judge is taught that a requested amount is preference only.

## Constitution

`purse-economic-constitution-v1.3` — finite Purse, magnitude has meaning, transfer = recognition, burn = permanent surrender (stronger reason), requested amounts do not set action.

## Settlement

Stage 12.6 → Purse passes **exact** validated `amountFormatted`.  
`purse_transfers` stores `amount_raw` + `amount_formatted`.  
Idempotency: same operation id + different amount → fail closed.

## Calibration (dry-run)

```bash
npm run agent:test-economic-judgement -- \
  --text "…" --operation-label p1c-A --dry-run
```

Dry-run JSON exposes:

- `modelEconomicAction` (type, proposedAmount, reason)
- `authorityEconomicSkippedReason`
- `authorityPlannedEffects` / `plannedEconomicAmount`

Default remains no broadcast. `--execute-model-intent` is P1B.2 disposable-rail only.

## Migration

`supabase/migrations/20260809160000_58_stage_p1c_economic_magnitude.sql` — comment update only.

## Out of scope

Conversational wallet collection, X↔Outlaw linking, dynamic budgets, reward tables, replenishment, multi-asset, Turnkey, Treasury.
