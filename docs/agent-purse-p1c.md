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

## Authority envelope (P2B production launch ceilings)

Three controls (catastrophe protection only — not reward tiers):

| Control | Env | Production hard max / default |
|---------|-----|-------------------------------|
| Max single transfer | `FENN_PURSE_MAX_SINGLE_TRANSFER` | `100000` |
| Max single burn | `FENN_PURSE_MAX_SINGLE_BURN` | `50000` |
| Max rolling 24h outflow | `FENN_PURSE_MAX_ROLLING_24H_OUTFLOW` | `500000` |

**Env may only tighten** (value ≤ hard max). Values above hard max, zero, negative, NaN, exponent forms, or malformed decimals **fail closed** (never open a wider envelope).

| Optional | Env | Value |
|----------|-----|-------|
| Wider harness envelope | `FENN_PURSE_AUTHORITY_LIMITS_PROFILE` | `test` only (explicit isolation) |

Test profile hard maxes (`2000000` / `500000` / `5000000`) apply **only** when profile is explicitly `test`. Production settlement always re-checks launch ceilings on the official rail.

On limit breach: refuse with `amount_exceeds_transfer_limit` / `amount_exceeds_burn_limit` / `amount_exceeds_rolling_24h_limit`. **Never execute a smaller amount.**

## User-requested amounts

Untrusted. Never parse X text into transaction amounts. The final judge is taught that a requested amount is preference only.

## Constitution

`purse-economic-constitution-v1.5` — finite Purse, magnitude has meaning, transfer = recognition, burn = permanent surrender (stronger reason), requested amounts do not set action. Destination availability is execution readiness — not merit; missing wallet must not force NONE.

## Settlement

Stage 12.6 → Purse passes **exact** validated `amountFormatted`.  
`purse_transfers` stores `amount_raw` + `amount_formatted`.  
Idempotency: same operation id + different amount → fail closed.  
Official adapter re-validates single-transfer/burn against production launch ceilings before broadcast (P2B defence-in-depth).

## Calibration (dry-run)

```bash
npm run agent:test-economic-judgement -- \
  --text="Send 10000 FENN as recognition" \
  --dry-run
```

Use `FENN_PURSE_AUTHORITY_LIMITS_PROFILE=test` only for harnesses that intentionally need the wider test envelope.
