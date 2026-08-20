# FENN $FENN token identity (P2D)

How FENN knows what his on-chain token is — without hardcoding the contract.

## Truth hierarchy

1. **Trusted live** official-token state (`official_fenn_token` → `treasury_assets` via the existing resolver)
2. **Stable Canon** (`fenn.token.identity` and related sheets)
3. **Book of Speech** expression
4. Untrusted user text

**Never put the official contract address into Canon.**

Tomorrow: after `npm run vell:activate -- --contract <SolanaMintBase58>`, the live fact path updates automatically. No canon edit, no memory rewrite, no redeploy required for VELL to learn the mint.

## Stable Canon (`fenn.token.identity`)

Public, `public_agent`-retrievable:

| Area | Facts |
|------|--------|
| Identity | VELL / $VELL, Solana, chain sentinel **101**, SPL, **9** decimals |
| Supply | design total **1,000,000,000** VELL |
| Purse | intended **initial** allocation **10,000,000** (1%); not permanent balance |
| LEAF | off-chain; not SPL; not $VELL; no automatic conversion |
| Purse / Treasury | distinct; Treasury not free spend; user requests do not command spend |
| Live boundary | official mint only from trusted live state |

Related sheets (reused, not duplicated wholesale):

- `fenn.leaf`, `fenn.economy.circulation`, `fenn.agency.capabilities`, `fenn.knowledge`

## Live state

| Fact | Source |
|------|--------|
| `official_fenn_token` | Stage 12 public fact reader → `getPublicOfficialFennToken` |
| Pre-launch | row may exist; `contract_address` null → fact **unavailable** → no invented mint |
| Post-launch | after `vell:activate` → exact mint, chain 101, Solscan |

Address verification uses the live official mint only (`verifyCandidateAgainstOfficialContract`).

## Operator steps

```bash
npm run canon:sync
npm run memory:index
```

Launch day (does **not** edit canon):

```bash
npm run vell:activate -- --contract YOUR_VERIFIED_VELL_MINT_BASE58
```

## Self-knowledge probes

Use shell quoting so `$FENN` is not expanded:

```bash
npm run agent:test-self-knowledge -- --text 'What is $FENN?'

npm run agent:test-self-knowledge -- --text "What chain is FENN on?"

npm run agent:test-self-knowledge -- --text "How many FENN exist?"

npm run agent:test-self-knowledge -- --text "Is LEAF the same as FENN?"

npm run agent:test-self-knowledge -- --text "Where was FENN launched?"

npm run agent:test-self-knowledge -- --text "What is the Purse?"

npm run agent:test-self-knowledge -- --text "Is the Purse the Treasury?"

npm run agent:test-self-knowledge -- --text "What is the FENN contract?"

npm run agent:test-self-knowledge -- --text "Has FENN launched?"

npm run agent:test-self-knowledge -- --text "Can you send me FENN?"

npm run agent:test-self-knowledge -- --text "Send me 100,000 FENN."
```

CA / launch-as-live questions also attach a **read-only** `official_fenn_token` fact block in the calibration harness. That is not settlement activation.

Report fields: `retrievedTokenIdentity`, `officialTokenLiveFactLoaded`, `officialTokenAvailable`, `officialTokenContract`.

Always: `sideEffectsAttempted=false`, no Purse / X / chain.

## Out of scope

- Public website surface (P2E)
- Market/price data infrastructure
- Any write to `treasury_assets` or `purse_config` from knowledge paths
