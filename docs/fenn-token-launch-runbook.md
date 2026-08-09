# FENN Token Launch Runbook (P2C.1)

Operations only. Contract address remains in Supabase `treasury_assets` — never hardcoded.

Canonical law: [P2C audit](./agent-purse-p1c.md) + `src/lib/treasury/official-token.ts` + P2A Purse Executor.

---

## Tonight

1. **Migrations** — apply through P2A, including `61_purse_p2a_executor` and `44_official_fenn_token`.
2. **Deploy** latest Vercel site + Render (`fenn-x-agent`, `fenn-purse-executor`).
3. **Dormant row** — run [ops/fenn-launch-prep.sql](./ops/fenn-launch-prep.sql) once in Supabase SQL editor.
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

## Tomorrow

1. Deploy official **$FENN** ERC-20 on Robinhood Chain (chain_id **4663**, **18** decimals).
2. Copy the verified **lowercase** `0x` contract address.
3. Edit [ops/fenn-launch-activate.sql](./ops/fenn-launch-activate.sql) — replace **exactly**:

```text
0xOFFICIAL_FENN_CONTRACT
```

with the real address (keep lowercase).
4. Run the activation SQL once. Confirm post-check shows `contract_address` set and **one** official/public row.
5. **Do not fund** until the address is confirmed correct on Blockscout.
6. Transfer **exactly 10,000,000 FENN** to the Purse address (`launch:check` / Desk / Commons).
7. Wait for the next `purse:settle` cron tick (~1 minute) so P2A can set-once `official_settlement_activated_at`.
8. Run:

```bash
npm run launch:check
```

9. **Expect** `status=LIVE_READY` when:
   - official resolves
   - activation timestamp set
   - brake **not** engaged
   - balance ≥ 10,000,000 **or** confirmed movements already exist after initial fund
10. Open `/commons` + homepage — official contract strip should appear (no redeploy; home ≤ ~60s ISR).
11. Optional: controlled economic smoke later (not part of launch ops).

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
- Activation SQL updates **only** `contract_address` on the dormant official FENN row.
- `launch:check` is read-only (`sideEffectsAttempted=false`, `chainBroadcastAttempted=false`).
