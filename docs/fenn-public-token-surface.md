# P2E — public $FENN surface

Public website verification for `$FENN` before and after launch.

## Surfaces

| Surface | Role |
|---------|------|
| `/` | Fast official-contract verification — top of world/map section (`HomeIdentity` → `HomeOfficialContract`, above the map) |
| `/commons` | Full identity · LEAF vs $FENN · official CA · Purse · Treasury |

No dedicated `/token` route.

## Source of truth

| Kind | Source |
|------|--------|
| Stable identity (chain, supply, decimals, initial Purse) | `fenn-token-public-identity.ts` aligned with Canon `fenn.token.identity` |
| Official contract address | `getPublicOfficialFennToken()` only (`treasury_assets` via resolver) |
| Live balances | Existing Treasury / Purse snapshots |

**Never** put the official CA in Canon, env, or static UI.

## Live update

| Route | Cache |
|-------|--------|
| `/` | ISR `revalidate = 60` — CA appears within about one minute after `launch:activate` |
| `/commons` | `force-dynamic` + world pulse 60s |

No redeploy after `launch:activate`.

## Manual checks — tonight (pre-launch)

1. Open `/` — see `$FENN · ROBINHOOD CHAIN`, **OFFICIAL CONTRACT**, **NOT YET INSCRIBED**. No `0x`, COPY, or explorer.
2. Open `/commons` — see `$FENN` identity facts, LEAF ≠ $FENN, **OFFICIAL CONTRACT / NOT YET INSCRIBED**, Purse **INITIAL ALLOCATION** + **awaiting official token**, SOL still in Treasury.

## Manual checks — launch day

```bash
npm run launch:activate -- --contract 0xVERIFIED_FENN_CONTRACT
# fund Purse with 10,000,000 FENN
# wait Purse Executor tick
npm run launch:check   # expect LIVE_READY
```

Then `/` and `/commons`: exact same official CA, COPY + VIEW CONTRACT, pending wording gone; initial allocation still labelled initial; ETH preserved.

See also: [fenn-token-identity.md](./fenn-token-identity.md), [fenn-token-launch-runbook.md](./fenn-token-launch-runbook.md).
