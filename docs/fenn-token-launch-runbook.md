# VELL Token Launch Runbook (Solana mint + launch:check / vell:activate)

Operations only. Mint address remains in Supabase `treasury_assets` — never hardcoded.

Canonical law: `src/lib/treasury/official-token.ts` + [ops/fenn-launch-prep.sql](./ops/fenn-launch-prep.sql).

**Primary mint configuration:** `npm run vell:activate -- --contract <SolanaMintBase58>` (alias: `launch:activate`)  
**Homepage:** header polls live DB — no redeploy after activate.

Official public identity is **Solana SPL** (`chain_id` sentinel **101**, decimals **6**, symbol **VELL**).  
Robinhood EVM Purse / fund-purse paths are **not** the site mint path; do not pass `0x…` to `vell:activate`.

---

## Tonight (prep)

1. **Migrations** — apply through Solana official mint support, including:
   - `44_official_fenn_token` (legacy Robinhood uniqueness — leave in place)
   - `62_treasury_assets_null_contract_uidx`
   - `64_solana_identity_wallets` (`is_normalized_solana_address`)
   - `65_treasury_assets_solana_official` (Solana mint CHECK + official/public **101** uidx)
2. **Deploy** latest Vercel site (homepage header + `/api/home/official-token`).
3. **Dormant row** — paste [ops/fenn-launch-prep.sql](./ops/fenn-launch-prep.sql) once in Supabase SQL editor.
   - Demotes leftover Robinhood official/public FENN flags.
   - Expected Solana row: `VELL | 101 | NULL | 9 | spl official/public`.
   - Expect NOTICE `VELL_LAUNCH_PREP_OK`.
4. **Readiness**:

```bash
npm run launch:check
```

5. **Expect** `status=PRE_LAUNCH_READY` with `officialContractResolved=false`.

---

## Launch-day sequence (authoritative)

1. **Deploy the SPL mint on Solana** (human holds deployer keys — not Stage 12).
2. **Verify mint externally** on Solscan (mint address, decimals **6**, symbol **VELL**).
3. **Configure official identity in DB**:

```bash
npm run vell:activate -- --contract YOUR_VERIFIED_VELL_MINT_BASE58
```

4. **Confirm site surfaces** (no redeploy):

- `GET /api/home/official-token` → mint + Solscan URL
- `/` header → abbreviated mint, copy, view

5. **Readiness (post-activate)**:

```bash
npm run launch:check
```

Expect mint configured. Default check **does not** read EVM ERC-20 Purse balance for the Solana mint (`solana_purse_balance_deferred` note). Solana Purse funding / `LIVE_READY` via EVM rails is out of scope until a Solana purse path exists.

### Activate CLI expected output

```text
mode=FENN_LAUNCH_ACTIVATE
status=CONFIGURED
symbol=VELL
chainId=101
decimals=6
contractAddress=<SolanaMintBase58>
official=true
publicContract=true
settlementActivated=false
chainBroadcastAttempted=false
sideEffectsAttempted=true
```

Same mint rerun → `status=ALREADY_CONFIGURED` (no second write).  
Different mint after live → `status=REFUSED` / `errorCode=official_contract_already_configured`.

---

### Emergency / manual SQL fallback (activate only)

If activate CLI cannot run: [ops/fenn-launch-activate.sql](./ops/fenn-launch-activate.sql) — replace `OFFICIAL_VELL_MINT` and run once. Prefer the CLI for normal launch day.

### Intermediate statuses after mint update

| Situation | status |
|-----------|--------|
| Mint set; settlement not activated | `TOKEN_CONFIGURED_AWAITING_ACTIVATION` |
| Activated; Solana purse funding not yet modeled | typically stays awaiting funding / deferred notes |
| Funded + activated (when Solana purse path exists) | `LIVE_READY` |

---

## Safety

- Prep SQL never sets `contract_address`.
- Dormant row → official resolver returns **none**.
- `vell:activate` updates **only** `contract_address` on the dormant official VELL row via a guarded NULL→mint write.
- `launch:check` is read-only (`sideEffectsAttempted=false`, `chainBroadcastAttempted=false`).
- Never put the official mint in env or Next public vars.
- Token identity knowledge: [fenn-token-identity.md](./fenn-token-identity.md) — **never** store the mint in Canon; live mint follows `vell:activate`.
- Public site: [fenn-public-token-surface.md](./fenn-public-token-surface.md).
