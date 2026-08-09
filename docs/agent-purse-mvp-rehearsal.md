# Full disposable MVP economic rehearsal

Operator harness that runs the complete pre-launch economic path without redesigning stages.

## Command

```bash
# Dry-run (default): real Stage 12.4 model + P1D wallet FSM + speech previews
# No chain. No live X.
npm run agent:rehearse-economic-flow -- \
  --text "I reported the issue." \
  --trusted-fact "FENN operators verified a consequential security contribution and remediation." \
  --reference-id rehearsal-security-001 \
  --wallet 0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174 \
  --confirm yes \
  --operation-label full-rehearsal-001

# Disposable chain (explicit): durable rows + Stage 12.6 + Purse test rail
npm run agent:rehearse-economic-flow -- \
  --text "I reported the issue." \
  --trusted-fact "FENN operators verified a consequential security contribution and remediation." \
  --reference-id rehearsal-security-001 \
  --wallet 0x92a4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab174 \
  --confirm yes \
  --operation-label full-rehearsal-001 \
  --execute-test
```

## What is reused

| Stage | Role |
| --- | --- |
| P1B / 12.4 | Real model economic judgement (no `--force-intent`) |
| P1C | Variable amount + authority envelope (refuse, never clamp) |
| P1D | Wallet collection FSM (`x_economic_interactions`) |
| P1D.1 | Book-of-Speech wallet replies |
| 12.5 | Effect planning / persist |
| 12.6 | Claim + economic adapter |
| Purse | Disposable test rail only |
| P1E | Completion speech **preview** after confirmed settlement |

## Laws

- `--wallet` is **user turn 1** text — never Stage 12.4 trusted wallet.
- No `--trusted-wallet` / no `--force-intent` (CLI rejects them).
- `trustedWalletAvailable: false` at judgement.
- Amount locked at judgement survives wallet turns.
- Completion speech only after confirmed settlement.
- **No live `@askfenn` X posts** (`liveXPostAttempted: false`).
- Optional later live test-rail X would require separate `FENN_P1E_ALLOW_TEST_FOLLOWUP_X=explicit_allow` — not part of this command.

## Execute-test prerequisites

```
FENN_PURSE_TEST_MODE=explicit_allow
FENN_PURSE_TEST_TOKEN_ADDRESS=…
FENN_PURSE_TEST_TOKEN_DECIMALS=…
FENN_PURSE_PRIVATE_KEY=…
ROBINHOOD_CHAIN_RPC_URL=…
```

Non-production host. Official FENN must not resolve. `is_test=true`.

## Idempotency

Deterministic `operationLabel` → synthetic author + post ids. Re-run of a completed settlement returns `already_completed` without rebroadcast.

## Modules

- `src/lib/agent/mvp-economic-rehearsal.ts`
- `scripts/agent-rehearse-economic-flow.ts`
- `src/lib/agent/stage-mvp-economic-rehearsal.test.ts`
