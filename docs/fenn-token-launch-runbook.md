# FENN Token Launch Runbook (P2C.1 / P2C.2 / P0 fund-purse)

Operations only. Contract address remains in Supabase `treasury_assets` — never hardcoded.

Canonical law: [P2C audit](./agent-purse-p1c.md) + `src/lib/treasury/official-token.ts` + P2A Purse Executor + P0 `launch:fund-purse`.

**Primary contract configuration:** `npm run vell:activate -- --contract <addr>` (alias: `launch:activate`)  
**Homepage:** header polls live DB — no redeploy after activate.

---

## Tonight (prep)

1. **Migrations** — apply through P2A / P2C.1 / P0 launch-fund schema, including:
   - `44_official_fenn_token` (official/public uniqueness)
   - `61_purse_p2a_executor`
   - `62_treasury_assets_null_contract_uidx` (ETH + dormant FENN NULL contracts coexist)
   - `63_fenn_launch_purse_funding` (`fenn_launch_operations` durable one-shot)
2. **Deploy** latest Vercel site + Render (`fenn-x-agent`, `fenn-purse-executor`).
3. **Dormant row** — paste [ops/fenn-launch-prep.sql](./ops/fenn-launch-prep.sql) once in Supabase SQL editor.
   - Must **not** modify existing ETH / native NULL-contract rows.
   - Expected grid: `ETH | 4663 | NULL | 18 | native` and `FENN | 4663 | NULL | 18 | official/public erc20`.
   - Expect NOTICE `FENN_LAUNCH_PREP_OK`.
4. **Readiness**:

```bash
npm run launch:check
```

5. **Expect** `status=PRE_LAUNCH_READY` with `officialContractResolved=false`.
6. **Purse Executor** (optional tick):

```bash
npm run purse:settle
```

Expect `official_fenn=unresolved settlement=idle chainBroadcastAttempted=false`.

---

## Launch-day sequence (authoritative)

1. **Deploy manually on Solana** (human holds deployer keys — not FENN/Stage 12).
2. **Verify contract externally** on Robinhood Blockscout (bytecode, decimals 18, symbol FENN).
3. **Configure official identity in DB**:

```bash
npm run vell:activate -- --contract 0xYOUR_VERIFIED_VELL_CONTRACT
```

4. **Do not fund** until the address is confirmed correct on Blockscout.
5. **Settlement activation** — wait for Purse Executor tick or run:

```bash
npm run purse:settle
```

6. **Readiness (post-activate, pre-fund)**:

```bash
npm run launch:check
```

Expect token configured; funding status absent unless already funded.

7. **Locally inject Treasury signer** (operator machine only) — optional for rehearsal:

```bash
export FENN_TREASURY_PRIVATE_KEY=0x…   # matches treasury_config; never commit
npm run launch:fund-purse:preflight   # read-only; never broadcasts
```

**Never** install `FENN_TREASURY_PRIVATE_KEY` on:

- Vercel
- Render (`fenn-x-agent`, `fenn-purse-executor`)
- generic production env validation
- Stage 12 / X agent runtime
- Purse Executor

No `NEXT_PUBLIC_*` form. Never store in DB. Never log.

Rehearsal (`launch:fund-purse:preflight`) may run **before** activate (expects `OFFICIAL FENN: WAITING`) and after activate (expects `READY TO FUND`). It never writes DB rows, never signs a transaction, and does not import the broadcast path.

8. **One-shot fund (exactly 10,000,000 FENN Treasury → Purse)**:

```bash
npm run launch:fund-purse
```

- No amount / token / recipient / chain CLI args (intent is fixed in code + canonical config).
- Durable identity: `fenn_launch_purse_funding_v1` in `fenn_launch_operations`.
- Second run prints `ALREADY_CONFIRMED` + launch speech + explorer URL — **never** sends another 10M.
- On ambiguous/timeout: re-run reconciles; **does not** rebroadcast.

9. **Verify confirmed tx** on the printed Robinhood Blockscout URL.
10. **Readiness (post-fund)**:

```bash
npm run launch:check
```

Check:

- `launchFundingConfirmed=true` / durable status `confirmed` (historical proof)
- live Purse FENN balance (current economic state — independent of history)
- `status=LIVE_READY` when activated + funded by balance/movements/durable rules

11. **Verify homepage / Commons / FENN self-knowledge**:

- `official_fenn_token` trusted fact → live CA after activate
- `fenn_launch_purse_funding` trusted fact → only after durable funding is **confirmed**
- Commons Purse HELD follows live chain; inbound launch funding is **not** a Purse MOVEMENT (outbound only)

### Activate CLI expected output

```text
mode=FENN_LAUNCH_ACTIVATE
status=CONFIGURED
symbol=FENN
chainId=4663
decimals=18
contractAddress=0x…
official=true
publicContract=true
settlementActivated=false
chainBroadcastAttempted=false
sideEffectsAttempted=true
```

Same address rerun → `status=ALREADY_CONFIGURED` (no second write).  
Different address after live → `status=REFUSED` / `errorCode=official_contract_already_configured`.

### Fund CLI expected speech (confirmed)

```text
10,000,000 FENN have left the Treasury.

They are in my Purse now.

the Greenwood has given me something it cannot take back:

the means to act.

https://robinhoodchain.blockscout.com/tx/0x…
```

---

### Emergency / manual SQL fallback (activate only)

If activate CLI cannot run: [ops/fenn-launch-activate.sql](./ops/fenn-launch-activate.sql) — replace `0xOFFICIAL_FENN_CONTRACT` and run once. Prefer the CLI for normal launch day.  
There is **no** SQL path for Treasury signing — fund via `launch:fund-purse` only.

### Intermediate statuses after contract update

| Situation | status |
|-----------|--------|
| Address set; executor not ticked | `TOKEN_CONFIGURED_AWAITING_ACTIVATION` |
| Activated; balance &lt; 10m; no movements; funding not durable-confirmed as live-ready path | `TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING` |
| Funded + activated | `LIVE_READY` |

---

## Emergency

| Condition | Action |
|-----------|--------|
| Wrong address **before** funding | **STOP**. Do not fund. Fix dormant/live row carefully with human SQL; activation template refuses overwrite if contract already set. |
| Wrong address **after** activation / spend | Do **not** casually rewrite token identity. Engagement brake: set `purse_config.economic_settlement_enabled = false`. |
| Fund tx ambiguous | Re-run `launch:fund-purse` to reconcile. Do **not** force a second private broadcast. |
| Runaway settlement | Same brake. Leaves effects pending (P2A). |
| Need to halt X speech | `FENN_X_AGENT_EXECUTION_MODE=disabled` on Render X service only. |

Do **not**:

- delete activation history / `official_settlement_activated_at`
- delete a **confirmed** `fenn_launch_operations` row to “re-fund”
- enable test-rail for production
- put official contract in env or Next public vars
- put `FENN_TREASURY_PRIVATE_KEY` on production services

---

## Allocation law (launch:check)

- `expectedLaunchAllocation` = **10000000** FENN (1% orientation; matches `PURSE_ORIGINAL_ALLOCATION_FORMATTED`).
- **Durable launch funding** (`fenn_launch_purse_funding_v1` confirmed) = historical proof the ceremony happened.
- **Live Purse balance** = current economic state (may fall after legitimate spends).
- **Initial launch**: `LIVE_READY` requires balance ≥ 10m while confirmed official movements = 0 (or subsequent movement / durable gates as reported by `launch:check`).
- **Ongoing**: after any confirmed official movement, balance &lt; 10m does **not** demote `LIVE_READY` solely for spend.

This is **not** economic authority or P2B ceiling law.

---

## Safety

- Prep SQL never sets `contract_address`.
- Dormant row → official resolver returns **none** / unavailable.
- `launch:activate` updates **only** `contract_address` on the dormant official FENN row via a guarded NULL→address write.
- `launch:fund-purse` is local-operator only; uses `FENN_TREASURY_PRIVATE_KEY` against canonical `treasury_config`.
- Funding is **not** recorded in `purse_transfers` (outbound-only ledger).
- Treasury library remains read-only for normal application use; signing lives under `src/lib/ops/`.
- `launch:check` is read-only (`sideEffectsAttempted=false`, `chainBroadcastAttempted=false`).
- Token identity knowledge (P2D): [fenn-token-identity.md](./fenn-token-identity.md) — **never** store the official CA in Canon; live CA follows `launch:activate`.
- Public site (P2E): [fenn-public-token-surface.md](./fenn-public-token-surface.md) — `/` + `/commons` show pending CA tonight and live CA after activate without redeploy.
- Truth boundary: FENN may state the contract is live and that 10M left Treasury for the Purse with a confirmed link; FENN must **not** claim it personally deployed the token or held the deployer key.
