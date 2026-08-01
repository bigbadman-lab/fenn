import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALL_GREENWOOD_SIGIL_DEFINITIONS,
  CURATED_GREENWOOD_SIGILS,
  GREENWOOD_SIGIL_MAX_HEIGHT,
  GREENWOOD_SIGIL_MAX_WIDTH,
  GREENWOOD_SIGIL_MIN_HEIGHT,
  UNMARKED_SIGIL,
  UNMARKED_SIGIL_ID,
  assertSigilGeometry,
} from "./sigil/catalogue";
import { normalizeAssignRpcRow } from "./sigil/assignment";
import { GreenwoodError } from "@/lib/greenwood/errors";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

describe("Greenwood sigil catalogue", () => {
  it("contains exactly 64 curated sigils plus UNMARKED", () => {
    assert.equal(CURATED_GREENWOOD_SIGILS.length, 64);
    assert.equal(ALL_GREENWOOD_SIGIL_DEFINITIONS.length, 65);
    assert.equal(UNMARKED_SIGIL.slug, "unmarked");
    assert.equal(UNMARKED_SIGIL.isFallback, true);
    assert.equal(UNMARKED_SIGIL.id, UNMARKED_SIGIL_ID);
  });

  it("has unique slugs and ids", () => {
    const slugs = new Set<string>();
    const ids = new Set<string>();
    for (const sigil of ALL_GREENWOOD_SIGIL_DEFINITIONS) {
      assert.equal(slugs.has(sigil.slug), false, `duplicate slug ${sigil.slug}`);
      assert.equal(ids.has(sigil.id), false, `duplicate id ${sigil.id}`);
      slugs.add(sigil.slug);
      ids.add(sigil.id);
    }
  });

  it("respects width/height limits and geometry", () => {
    for (const sigil of ALL_GREENWOOD_SIGIL_DEFINITIONS) {
      const err = assertSigilGeometry(sigil);
      assert.equal(err, null, err ?? undefined);
      assert.ok(sigil.width <= GREENWOOD_SIGIL_MAX_WIDTH);
      assert.ok(sigil.height >= GREENWOOD_SIGIL_MIN_HEIGHT);
      assert.ok(sigil.height <= GREENWOOD_SIGIL_MAX_HEIGHT);
    }
  });

  it("keeps curated bodies free of alphanumeric identity glyphs", () => {
    for (const sigil of CURATED_GREENWOOD_SIGILS) {
      assert.doesNotMatch(sigil.asciiBody, /[0-9A-Za-z]/);
      assert.ok(sigil.a11yLabel.trim().length > 0);
    }
  });

  it("orders curated marks by sort_order 1..64", () => {
    const orders = CURATED_GREENWOOD_SIGILS.map((s) => s.sortOrder);
    assert.deepEqual(
      orders,
      Array.from({ length: 64 }, (_, i) => i + 1),
    );
  });
});

describe("normalizeAssignRpcRow", () => {
  it("maps RPC row to safe assignment result", () => {
    const out = normalizeAssignRpcRow({
      profile_id: "11111111-1111-4111-8111-111111111111",
      sigil_id: UNMARKED_SIGIL_ID,
      slug: "unmarked",
      ascii_body: UNMARKED_SIGIL.asciiBody,
      a11y_label: UNMARKED_SIGIL.a11yLabel,
      width: 5,
      height: 3,
      is_fallback: true,
      newly_assigned: false,
      assigned_at: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(out.slug, "unmarked");
    assert.equal(out.isFallback, true);
    assert.equal(out.newlyAssigned, false);
    assert.equal(out.width, 5);
  });
});

describe("assignGreenwoodSigil helpers", () => {
  it("is idempotent for repeated RPC rows", async () => {
    const { assignGreenwoodSigil } = await import("./sigil/assignment");
    const row = {
      profile_id: "11111111-1111-4111-8111-111111111111",
      sigil_id: "a0000000-0000-4000-8000-000000000002",
      slug: "twin-sparks",
      ascii_body: CURATED_GREENWOOD_SIGILS[1]!.asciiBody,
      a11y_label: CURATED_GREENWOOD_SIGILS[1]!.a11yLabel,
      width: CURATED_GREENWOOD_SIGILS[1]!.width,
      height: CURATED_GREENWOOD_SIGILS[1]!.height,
      is_fallback: false,
      newly_assigned: false,
      assigned_at: "2026-08-01T00:00:00.000Z",
    };
    let calls = 0;
    const admin = {
      async rpc(name: string, args: { p_profile_id: string }) {
        calls += 1;
        assert.equal(name, "assign_greenwood_sigil");
        assert.equal(args.p_profile_id, row.profile_id);
        return { data: [row], error: null };
      },
    };
    const first = await assignGreenwoodSigil(
      row.profile_id,
      "system",
      admin as never,
    );
    const second = await assignGreenwoodSigil(
      row.profile_id,
      "system",
      admin as never,
    );
    assert.equal(calls, 2);
    assert.equal(first.sigilId, second.sigilId);
    assert.equal(first.slug, "twin-sparks");
    assert.equal(first.newlyAssigned, false);
  });

  it("rejects non-member assignment errors as membership required", async () => {
    const { assignGreenwoodSigil } = await import("./sigil/assignment");
    const admin = {
      async rpc() {
        return {
          data: null,
          error: {
            message:
              "FENN_GREENWOOD_MEMBERSHIP_REQUIRED: profile is not a Greenwood member",
          },
        };
      },
    };
    await assert.rejects(
      () =>
        assignGreenwoodSigil(
          "11111111-1111-4111-8111-111111111111",
          "system",
          admin as never,
        ),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_membership_required",
    );
  });
});

describe("Living Greenwood 1 source safety", () => {
  it("migration seeds catalogue and assign RPC with service_role only", () => {
    const migration = readFileSync(
      join(
        repoRoot,
        "supabase/migrations/20260801100000_33_living_greenwood_1_sigils.sql",
      ),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE public\.greenwood_sigil_catalogue/);
    assert.match(migration, /CREATE TABLE public\.greenwood_sigil_assignments/);
    assert.match(migration, /assign_greenwood_sigil/);
    assert.match(migration, /backfill_greenwood_sigils/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.assign_greenwood_sigil/);
    assert.match(migration, /TO service_role/);
    assert.match(migration, /outlaw_number ASC NULLS LAST/);
    assert.match(migration, /sort_order ASC, c\.id ASC/);
    assert.match(migration, /unmarked/);
    assert.doesNotMatch(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.assign_greenwood_sigil[\s\S]*TO authenticated/,
    );
  });

  it("client Fire UI cannot assign by profile id", () => {
    const member = readFileSync(
      join(repoRoot, "src/components/greenwood/greenwood-member.tsx"),
      "utf8",
    );
    const enter = readFileSync(
      join(repoRoot, "src/app/api/greenwood/enter/route.ts"),
      "utf8",
    );
    const status = readFileSync(
      join(repoRoot, "src/app/api/greenwood/status/route.ts"),
      "utf8",
    );
    assert.doesNotMatch(member, /assignGreenwoodSigil|ensureMemberSigil/);
    assert.doesNotMatch(member, /createAdminClient|service_role/);
    assert.doesNotMatch(enter, /body\.profileId|parsed\.profileId/);
    assert.doesNotMatch(status, /body\.profileId/);
    assert.match(status, /getVerifiedPrivyUser/);
    assert.match(enter, /getVerifiedPrivyUser/);
  });

  it("admission ensures sigil without awarding LEAF", () => {
    const admission = readFileSync(
      join(repoRoot, "src/lib/greenwood/admission.ts"),
      "utf8",
    );
    assert.match(admission, /ensureMemberSigil|tryEnsureSigilAfterAdmission/);
    assert.doesNotMatch(admission, /awardLeaf|leaf_ledger|admin_adjust_leaf/);
  });

  it("Fire message stays static and non-claiming", () => {
    const message = readFileSync(
      join(repoRoot, "src/lib/greenwood/fire-message.ts"),
      "utf8",
    );
    assert.match(message, /The fire is small/);
    assert.doesNotMatch(message, /currently present|raise.?hand|gathering is live/i);
  });
});
