# Stage P1A — `transfer_fenn` Stage 12 effect → proven Purse settlement

## What P1A proves

An **explicitly authorised** Stage 12 effect of type `transfer_fenn` can:

1. pass deterministic payload authority validation  
2. be claimed/executed by Stage 12.6  
3. invoke the **existing** Purse P0 settlement path  
4. complete only after **confirmed** chain settlement  
5. reuse a **deterministic** Purse `operation_id` on retry (no double-send)

It does **not** prove model economic judgement, variable amounts, or X wallet collection.

## Effect contract

```json
{
  "recipientAddress": "0x…",
  "amountFormatted": "1",
  "executionRail": "p1a_test"
}
```

| Field | Rule |
|-------|------|
| `recipientAddress` | Normalized EVM address required |
| `amountFormatted` | Must be exactly `"1"` |
| `executionRail` | `"p1a_test"` → disposable token rail; omitted/`"official"` → official FENN only |
| token / chain / calldata / key | **Forbidden** in payload |

Chain is always Robinhood **4663** (Purse module). Stage 12 never chooses the token contract.

## Deterministic operation-id mapping

```
purse.operation_id = stage12:transfer_fenn:<effect_uuid>
```

- Same Stage 12 effect id → same Purse operation id  
- Worker retries reuse the same mapping  
- Never random per attempt  

Effect-row uniqueness for P1A ops uses:

```
idempotency_key = p1a:transfer_fenn:<operation-label>
```

## Lifecycle

```
effect pending
  → claim (processing)
  → validateTransferFennEffectPayload
  → executeTransferFennViaPurse
  → purse pending → submitted → confirmed
  → complete_x_perception_effect(external_result_id = tx_hash)
```

| Purse outcome | Stage 12.6 |
|---------------|------------|
| confirmed | complete |
| pre_broadcast / temporary | `failure_class=retryable` |
| terminal revert / invalid | `terminal` |
| ambiguous | `ambiguous` (list visible; no blind rebroadcast) |

Already-confirmed Purse settlement → Stage 12 completes with that `tx_hash` (`reusedExisting`).

## Dry-run / live

| Mode | Behaviour |
|------|-----------|
| `--dry-run` / Stage 12.6 `dryRun: true` | Lists pending; **does not claim**; **never** calls Purse broadcast |
| Live P1A CLI | Scaffolds effect + `executeOneXPerceptionEffect` (real claim + dispatch) |

Ordinary Stage 12 live agents do **not** plan `transfer_fenn` today (judgement schema unchanged).

## Why the model cannot originate transfers yet

- `STAGE12_LIVE_AGENT_ACTIONS` has no transfer action  
- Final-judge schema unchanged  
- Authority planner never emits `transfer_fenn`  
- Only the controlled P1A scaffold / CLI creates these effects  

## Pre-launch test procedure

1. Apply migrations through `55_stage_p1a_transfer_fenn.sql` (and Purse test isolation).  
2. Arm disposable-token envs (`FENN_PURSE_TEST_MODE=explicit_allow`, token address/decimals).  
3. Fund Purse with gas + ≥1 test token.  
4. Run:

```bash
npm run agent:test-purse-effect -- \
  --to 0xYOUR_RECIPIENT \
  --operation-label p1a-001
```

Optional preview without claim/broadcast:

```bash
npm run agent:test-purse-effect -- --to 0x… --operation-label p1a-001 --dry-run
```

5. Expect JSON with `mode: P1A_TEST`, `externalResultId` = tx hash when complete.  
6. Re-run the **same** `--operation-label` → should complete via existing settlement (no second chain send).  
7. Confirm `/commons` does **not** show `is_test=true` movements.

## Security boundary

```
MODEL (cannot originate yet)
  → AUTHORITY / P1A scaffold (no key)
  → transfer_fenn effect (no key, no token, amount=1)
  → executeTransferFennViaPurse adapter (no key)
  → Purse module + FENN_PURSE_PRIVATE_KEY
  → chain
```

Treasury is unreachable from the transfer executor.

## Toward P1B

P1B should add **judgement/authority** so eligible perceptions can plan `transfer_fenn` under economic constitution rules — still fixed amount initially, still official FENN only in live, still no key in Stage 12. P1A only builds the execution bridge.
