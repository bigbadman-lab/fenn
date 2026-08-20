# P2E — public $VELL surface

Public website verification for `$VELL` before and after launch.

## Surfaces

| Surface | Role |
|---------|------|
| `/` | Fast official-mint verification — top strip (`HomeHeaderContract`) |
| `/commons` | Full identity · LEAF vs $VELL · official mint · Purse · Treasury |

No dedicated `/token` route.

## Source of truth

| Kind | Source |
|------|--------|
| Stable identity (chain, supply, decimals, initial Purse) | `fenn-token-public-identity.ts` aligned with Canon `fenn.token.identity` |
| Official mint address | `getPublicOfficialFennToken()` only (`treasury_assets` via resolver) |
| Live balances | Existing Treasury / Purse snapshots (EVM rails until Solana purse exists) |

**Never** put the official mint in Canon, env, or static UI.

## Live update

| Route | Cache |
|-------|--------|
| `/` | Header polls `/api/home/official-token` — mint appears without redeploy after `vell:activate` |
| `/commons` | `force-dynamic` + world pulse 60s |

## Manual checks — tonight (pre-launch)

1. Open `/` — see `$VELL · SOLANA`, **OFFICIAL CONTRACT**, **NOT YET INSCRIBED**. No mint, COPY, or explorer.
2. Open `/commons` — see `$VELL` identity facts (SPL, 6 decimals, mainnet-beta), LEAF ≠ $VELL, mint pending.

## Manual checks — launch day

```bash
npm run vell:activate -- --contract YOUR_VERIFIED_VELL_MINT_BASE58
npm run launch:check   # expect mint configured; Solana purse balance deferred
```

Then `/` and `/commons`: exact same official mint, COPY + VIEW, Solscan account link; pending wording gone.

See also: [fenn-token-identity.md](./fenn-token-identity.md), [fenn-token-launch-runbook.md](./fenn-token-launch-runbook.md).
