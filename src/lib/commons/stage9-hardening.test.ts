import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Stage 9.5 Treasury + Commons hardening", () => {
  it("locks a single Robinhood Chain ID with no env competitor", () => {
    assert.equal(ROBINHOOD_CHAIN_ID, 4663);
    const def = read("src/lib/treasury/chain-definition.ts");
    assert.match(def, /export const ROBINHOOD_CHAIN_ID = 4663/);
    assert.doesNotMatch(def, /process\.env/);

    const envExample = read(".env.example");
    assert.match(envExample, /ROBINHOOD_CHAIN_RPC_URL/);
    assert.doesNotMatch(envExample, /NEXT_PUBLIC_.*RPC|NEXT_PUBLIC_.*TREASURY/);
    assert.match(envExample, /treasury_config/);
    assert.match(envExample, /tracked treasury_assets/);
  });

  it("wallet authority: product reads never use env fallback", () => {
    const config = read("src/lib/treasury/config.ts");
    const start = config.indexOf("export async function getTreasuryConfig");
    const end = config.indexOf(
      "export function readTreasuryBootstrapAddressFromEnv",
    );
    assert.ok(start >= 0 && end > start);
    const body = config.slice(start, end);
    assert.doesNotMatch(body, /FENN_TREASURY_ADDRESS|process\.env/);

    const snapshot = read("src/lib/treasury/snapshot.ts");
    assert.match(snapshot, /getTreasuryConfig/);
    assert.doesNotMatch(snapshot, /readTreasuryBootstrapAddressFromEnv/);
    assert.doesNotMatch(snapshot, /FENN_TREASURY_ADDRESS/);
  });

  it("chain modules remain read-only and server-only", () => {
    for (const file of [
      "src/lib/treasury/chain.ts",
      "src/lib/treasury/snapshot.ts",
      "src/lib/treasury/config.ts",
      "src/lib/treasury/assets.ts",
      "src/lib/treasury/contributions-query.ts",
      "src/lib/commons/commitments.ts",
      "src/lib/commons/snapshot.ts",
      "src/lib/commons/page-data.ts",
    ]) {
      const source = read(file);
      assert.match(source, /server-only/);
      assert.doesNotMatch(
        source,
        /writeContract|sendTransaction|privateKey|mnemonic|createWalletClient|getWalletClient/i,
      );
      assert.doesNotMatch(source, /NEXT_PUBLIC_/);
    }
  });

  it("API routes are public GET-only with no-store", () => {
    for (const file of [
      "src/app/api/treasury/route.ts",
      "src/app/api/commons/route.ts",
    ]) {
      const source = read(file);
      assert.match(source, /export async function GET/);
      assert.doesNotMatch(source, /export async function (POST|PATCH|PUT|DELETE)/);
      assert.match(source, /force-dynamic/);
      assert.match(source, /no-store/);
      assert.doesNotMatch(source, /getVerifiedPrivyUser|from ["']@\/lib\/auth/);
      assert.doesNotMatch(source, /request\.json\(|searchParams/);
    }
  });

  it("public DTOs omit notes/actors/RPC and keep exact amounts", () => {
    const treasuryDto = read("src/lib/treasury/contributions.ts");
    const pubStart = treasuryDto.indexOf("return {");
    assert.ok(pubStart >= 0);
    assert.doesNotMatch(treasuryDto.slice(pubStart), /^\s*notes:/m);

    const commonsDto = read("src/lib/commons/dto.ts");
    for (const fn of [
      "export function toPublicCommonsCommitment",
      "export function toPublicCommonsAllocationDelta",
    ]) {
      const start = commonsDto.indexOf(fn);
      assert.ok(start >= 0);
      const body = commonsDto.slice(start, start + 500);
      const ret = body.indexOf("return {");
      assert.ok(ret >= 0);
      assert.doesNotMatch(body.slice(ret), /^\s*notes:|^\s*actor_id:|^\s*updated_by/m);
    }

    const commitmentType = read("src/lib/commons/types.ts");
    assert.doesNotMatch(
      commitmentType,
      /notes:|actor_id:|updated_by_actor_id:/,
    );

    const types = read("src/lib/treasury/types.ts");
    assert.match(types, /state: "unconfigured"/);
    assert.match(types, /state: "available"/);
    assert.match(types, /state: "unavailable"/);
    assert.doesNotMatch(types, /rpcUrl|ROBINHOOD_CHAIN_RPC/);
  });

  it("holdings and commitments are never reconstructed from history", () => {
    const treasurySnap = read("src/lib/treasury/snapshot.ts");
    assert.match(treasurySnap, /readNative|readErc20/);
    assert.doesNotMatch(
      treasurySnap,
      /reduce\(|sum\(|contribution.*balance|held\s*=/i,
    );

    const commonsSnap = read("src/lib/commons/snapshot.ts");
    assert.match(commonsSnap, /getCommitments/);
    assert.doesNotMatch(
      commonsSnap,
      /reduce\(|sum\(|deltaAmount.*\+|commitment.*=.*delta/i,
    );

    const commitments = read("src/lib/commons/commitments.ts");
    const bodyStart = commitments.indexOf(
      "export async function getCommonsCommitments",
    );
    const bodyEnd = commitments.indexOf(
      "export async function getCommonsAllocationHistory",
    );
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
    assert.doesNotMatch(
      commitments.slice(bodyStart, bodyEnd),
      /commons_allocations/,
    );
  });

  it("UI keeps separate held vs committed facts with no Stage 10 bleed", () => {
    const page = read("src/app/commons/page.tsx");
    assert.match(page, /loadCommonsPageData/);
    assert.match(page, /NEXT CIRCULATION/);
    assert.match(page, /not announced/);
    assert.doesNotMatch(page, /AVAILABLE TO CIRCULATE|UNCOMMITTED|REMAINING/);
    assert.doesNotMatch(page, /"use client"/);
    assert.doesNotMatch(page, /from ["']@\/lib\/circulation|circulation_recipients/);

    const componentsDir = join(root, "components/commons");
    for (const file of readdirSync(componentsDir).filter((f) =>
      f.endsWith(".tsx"),
    )) {
      const source = readFileSync(join(componentsDir, file), "utf8");
      assert.doesNotMatch(source, /"use client"/);
      assert.doesNotMatch(
        source,
        /from ["']@\/lib\/circulation|circulation_recipients|\.from\(["']circulations["']\)/,
      );
      assert.doesNotMatch(source, /TOTAL TREASURY|coingecko|live value/i);
      assert.doesNotMatch(source, /Number\([^)]*(balance|amount|delta)/);
    }
  });

  it("ledger route remains untouched Stage 10 shell", () => {
    const ledger = read("src/app/ledger/page.tsx");
    assert.doesNotMatch(ledger, /getPublicTreasurySnapshot|getPublicCommonsSnapshot/);
    assert.doesNotMatch(ledger, /circulation_recipients/);
  });

  it("ops example and Stage 9 verify SQL exist and stay non-destructive", () => {
    const example = read(
      "supabase/examples/stage9_treasury_ops_example.sql",
    );
    assert.match(example, /Do NOT apply as a migration/);
    assert.match(example, /4663/);
    assert.match(example, /PLACEHOLDER/);
    assert.doesNotMatch(example, /^INSERT INTO/m);

    const verify = read("supabase/verify_stage9_treasury_commons.sql");
    assert.match(verify, /FORBIDDEN_COLUMNS|B_FORBIDDEN_COLUMNS/);
    assert.match(verify, /circulation_recipients/);
    assert.match(verify, /G_MUTATION_GRANT_VIOLATIONS/);
    assert.match(verify, /no_recipient_public_select|F_NO_RECIPIENT_PUBLIC_SELECT/);
    assert.doesNotMatch(verify, /\bCOMMIT\b/);
    assert.doesNotMatch(verify, /INSERT INTO public\.treasury_config/);
  });

  it("economic Number coercion is absent from Stage 9 lib modules", () => {
    const files = [
      "src/lib/treasury/amounts.ts",
      "src/lib/treasury/snapshot.ts",
      "src/lib/treasury/chain.ts",
      "src/lib/commons/numeric.ts",
      "src/lib/commons/dto.ts",
      "src/lib/commons/snapshot.ts",
      "src/lib/commons/format.ts",
      "src/lib/commons/page-data.ts",
    ];
    for (const file of files) {
      const source = read(file);
      assert.doesNotMatch(source, /parseFloat|parseInt|\.toFixed\(/);
      // Ignore safe Number.* helpers and documentation mentions.
      const codeOnly = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/Number\.is(Integer|Finite|SafeInteger|NaN)/g, "SAFE")
        .replace(/Number\.MAX_SAFE_INTEGER/g, "SAFE");
      assert.doesNotMatch(codeOnly, /\bNumber\s*\(/);
    }
  });
});
