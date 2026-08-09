# Stage P1E — Post-confirmation economic speech + X proof

## Law

**APPLICATION OWNS TRUTH. FENN OWNS THE WORDS.**

After Purse settlement status = **confirmed** only:

1. Build trusted `EconomicCompletionFacts` (amount, recipient, tx hash, explorer URL, timestamp, isTest, effect id)
2. Book of Speech expression (validated; one regen then deterministic fallback)
3. Durable `reply_on_x` effect with `idempotency_key = stage12:economic_followup:<economic-effect-id>`
4. Stage 12.6 claims + posts via the existing X OAuth executor

Never success speech for pending / submitted / ambiguous / failed. Never infer confirmation from tx hash alone — adapter `ok: true` already requires Purse confirmation; planner also requires non-empty `confirmedAt`.

## Runtime boundary (preferred live architecture)

| Runtime | Owns |
| --- | --- |
| Purse settlement | Signs/broadcasts, confirms, persists transfer truth |
| Stage 12.6 agent | After economic effect completes as confirmed → plans completion speech + inserts `reply_on_x` |
| Stage 12.6 X path | Claims pending `reply_on_x`, posts with OAuth |

**Purse does not need X OAuth.** Signing keys never enter speech prompts or effect planners.

## Settlement → speech ordering

```
submitted / pending / ambiguous / failed  → NO success follow-up
confirmed                              → completion reply may be planned
```

## Interaction lifecycle (P1D)

| Event | Interaction status |
| --- | --- |
| Wallet confirm alone | `wallet_confirmed` (not completed) |
| Broadcast alone | still not `completed` |
| Stage 12.6 transfer success + confirmed | `completed` + `transfer_effect_id` linked |

## Test isolation

Disposable rail (`isTest=true`) speech can be generated and previewed, but **reply effects are not persisted** unless:

```
FENN_P1E_ALLOW_TEST_FOLLOWUP_X=explicit_allow
```

Dry-run harness never persists effects.

## Reply target

Follow-up `replyToXPostId` must equal the economic effect’s perception event `x_post_id` (Stage 12.6 `reply_target_mismatch` guard). For wallet flows that re-authorize on the confirmation turn, that is the confirmation post. Preferred thread from `x_economic_interactions.confirmation_source_x_post_id` is recorded for audit when available.

## Explorer

Uses Commons helper `explorerTxUrl` + `ROBINHOOD_CHAIN_ID` — no separate Robinhood URL logic.

## Failure speech

P1E does **not** build a broad on-chain-failure conversation framework. Failed transfer after wallet confirm marks interaction failed; no success speech. Safe future hook: same planner with a distinct failure fact DTO after terminal post-confirm failure only.

## Dry-run harness

```bash
npm run agent:test-economic-completion -- --label demo
npm run agent:test-economic-completion -- --label demo --transfer-amount 25000 --burn-amount 50000 --wallet 0x92a4…b174
```

## Unit tests

```bash
npx tsx --conditions=react-server --test src/lib/agent/stage-p1e-economic-completion.test.ts
```

## Modules

| File | Role |
| --- | --- |
| `economic-followup.ts` | Facts DTO, explorer, validate, fallback, idempotency key, test allow-gate |
| `economic-completion-prompt.ts` | Constrained BoS prompts |
| `economic-completion-speech.ts` | Writer + validate + regenerate + fallback |
| `economic-completion-plan.ts` | Plan + optional `x_perception_effects` insert |
| `stage126-execute.ts` | Wire after transfer/burn success only |
| `p1e-economic-completion-test.ts` | In-memory harness |
| `scripts/agent-test-economic-completion.ts` | CLI |
