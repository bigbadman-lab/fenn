# FENN Token Launch Runbook (P2C.1 / P2C.2)

Operations only. Contract address remains in Supabase `treasury_assets` — never hardcoded.

Canonical law: [P2C audit](./agent-purse-p1c.md) + `src/lib/treasury/official-token.ts` + P2A Purse Executor.

**Primary launch-day contract configuration:** `npm run launch:activate -- --contract <addr>` (P2C.2). Manual SQL is emergency fallback only.

---

## Tonight

1. **Migrations** — apply through P2A / P2C.1 schema, including:
   - `44_official_fenn_token` (official/public uniqueness)
   - `61_purse_p2a_executor`
   - `62_treasury_assets_null_contract_uidx` (ETH + dormant FENN NULL contracts coexist)
2. **Deploy** latest Vercel site + Render (`fenn-x-agent`, `fenn-purse-executor`).
3. **Dormant row** — paste [ops/fenn-launch-prep.sql](./ops/fenn-launch-prep.sql) once in Supabase SQL editor (single `DO $$` block + verification `SELECT`; not multi-statement TEMP/CTE scan).
   - Must **not** modify existing ETH / native NULL-contract rows.
   - Expected grid: `ETH | 4663 | NULL | 18 | native` and `FENN | 4663 | NULL | 18 | official/public erc20`.
   - Expect NOTICE `FENN_LAUNCH_PREP_OK` (inserted or already prepared).
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

## Tomorrow (PRIMARY)

1. Deploy official **$FENN** ERC-20 on Robinhood Chain (chain_id **4663**, **18** decimals).
2. Copy the verified **`0x` contract address** (CLI normalizes to lowercase).
3. Configure the dormant official row with **one CLI command** (no SQL edit):

```bash
npm run launch:activate -- --contract 0xYOUR_VERIFIED_FENN_CONTRACT
```

Expect:

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
Different address after live → `status=REFUSED` / `errorCode=official_contract_already_configured` (never overwrites).

4. **Do not fund** until the address is confirmed correct on Blockscout.
5. Wait for the next Purse Executor tick (`purse:settle` / Render cron) so P2A can set-once settlement activation.
6. Transfer **exactly 10,000,000 FENN** to the Purse address.
7. Run:

```bash
npm run launch:check
```

8. **Expect** `status=LIVE_READY` when:
   - official resolves
   - activation timestamp set
   - brake **not** engaged
   - balance ≥ 10,000,000 **or** confirmed movements already exist after initial fund
9. Open `/commons` + homepage — official contract strip should appear (no redeploy; home ≤ ~60s ISR).
10. Optional: controlled economic smoke later (not part of launch ops).

### Emergency / manual SQL fallback

If the CLI cannot run (env / ops edge case only): [ops/fenn-launch-activate.sql](./ops/fenn-launch-activate.sql) — replace `0xOFFICIAL_FENN_CONTRACT` and run once. Prefer the CLI for normal launch day.

### Intermediate statuses after contract update

| Situation | status |
|-----------|--------|
| Address set; executor not ticked | `TOKEN_CONFIGURED_AWAITING_ACTIVATION` |
| Activated; balance &lt; 10m; no movements | `TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING` |
| Funded + activated | `LIVE_READY` |

---

## Emergency

| Condition | Action |
|-----------|--------|
| Wrong address **before** funding | **STOP**. Do not fund. Fix dormant/live row carefully with human SQL; activation template refuses overwrite if contract already set. |
| Wrong address **after** activation / spend | Do **not** casually rewrite token identity. Engagement brake: set `purse_config.economic_settlement_enabled = false`. |
| Runaway settlement | Same brake. Leaves effects pending (P2A). |
| Need to halt X speech | `FENN_X_AGENT_EXECUTION_MODE=disabled` on Render X service only. |

Do **not**:

- delete activation history / `official_settlement_activated_at`
- enable test-rail for production
- put official contract in env or Next public vars

---

## Allocation law (launch:check)

- `expectedLaunchAllocation` = **10000000** FENN (1% orientation; matches `PURSE_ORIGINAL_ALLOCATION_FORMATTED`).
- **Initial launch**: `LIVE_READY` requires balance ≥ 10m while confirmed official movements = 0.
- **Ongoing**: after any confirmed official movement, balance &lt; 10m does **not** demote `LIVE_READY` solely for spend.

This is **not** economic authority or P2B ceiling law.

---

## Safety

- Prep SQL never sets `contract_address`.
- Dormant row → official resolver returns **none** / unavailable.
- `launch:activate` (primary) updates **only** `contract_address` on the dormant official FENN row via a guarded NULL→address write.
- Activation SQL is emergency fallback with the same single-column intent.
- Neither path sets settlement activation; Purse Executor does that on tick.
- `launch:check` is read-only (`sideEffectsAttempted=false`, `chainBroadcastAttempted=false`).
