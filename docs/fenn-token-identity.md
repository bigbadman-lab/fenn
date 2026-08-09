# FENN $FENN token identity (P2D)

How FENN knows what his on-chain token is — without hardcoding the contract.

## Truth hierarchy

1. **Trusted live** official-token state (`official_fenn_token` → `treasury_assets` via the existing resolver)
2. **Stable Canon** (`fenn.token.identity` and related sheets)
3. **Book of Speech** expression
4. Untrusted user text

**Never put the official contract address into Canon.**

Tomorrow: after `npm run launch:activate -- --contract 0x…`, the live fact path updates automatically. No canon edit, no memory rewrite, no redeploy required for FENN to learn the CA.

## Stable Canon (`fenn.token.identity`)

Public, `public_agent`-retrievable:

| Area | Facts |
|------|--------|
| Identity | FENN / $FENN, Robinhood Chain, chain ID **4663**, ERC-20, **18** decimals |
| Supply | design total **1,000,000,000** FENN |
| Purse | intended **initial** allocation **10,000,000** (1%); not permanent balance |
| LEAF | off-chain; not ERC-20; not $FENN; no automatic conversion |
| Purse / Treasury | distinct; Treasury not free spend; user requests do not command spend |
| PONS | public launchpad / route onto Robinhood Chain; non-custodial; not owner / Purse / Treasury |
| Live boundary | official CA only from trusted live state |

First-person launch speech (“I launched through PONS”) is allowed when grounded in this Canon; technical key/wallet claims must not be invented.

Related sheets (reused, not duplicated wholesale):

- `fenn.leaf`, `fenn.economy.circulation`, `fenn.agency.capabilities`, `fenn.knowledge`

## Live state

| Fact | Source |
|------|--------|
| `official_fenn_token` | Stage 12 public fact reader → `getPublicOfficialFennToken` |
| Pre-launch | row may exist; `contract_address` null → fact **unavailable** → no invented CA |
| Post-launch | after `launch:activate` → exact contract, chain 4663, explorer |

Address verification uses the live official address only (`verifyCandidateAgainstOfficialContract`).

## Operator steps

```bash
npm run canon:sync
npm run memory:index
```

Launch day (does **not** edit canon):

```bash
npm run launch:activate -- --contract 0xYOUR_VERIFIED_FENN_CONTRACT
```

## Self-knowledge probes

Use shell quoting so `$FENN` is not expanded:

```bash
npm run agent:test-self-knowledge -- --text 'What is $FENN?'

npm run agent:test-self-knowledge -- --text "What chain is FENN on?"

npm run agent:test-self-knowledge -- --text "How many FENN exist?"

npm run agent:test-self-knowledge -- --text "Is LEAF the same as FENN?"

npm run agent:test-self-knowledge -- --text "Where was FENN launched?"

npm run agent:test-self-knowledge -- --text "Did you launch through PONS?"

npm run agent:test-self-knowledge -- --text "Does PONS control FENN?"

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
