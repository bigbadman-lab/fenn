import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS,
  DeedAuthoringError,
  assertDraftEditable,
  assertPublishAccessScope,
  assertStatusTransition,
  assertValidRewardForPublish,
  createDeedDraftSchema,
  deedRewardInputSchema,
  generateDraftSlug,
  normalizeEvidenceRequirements,
  normalizeSlugCandidate,
  rewardToColumns,
  updateDeedDraftSchema,
  validateDateWindow,
} from "@/lib/deeds/authoring-validation";
import {
  deedSubmissionWallSourceExternalId,
} from "@/lib/deeds/submission-wall";
import { parseEvidenceRequirements } from "@/lib/deeds/evidence";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("Deed authoring validation", () => {
  it("maps fixed/range/none rewards to DB columns without fake fixed zero", () => {
    assert.deepEqual(rewardToColumns({ type: "fixed", amount: 0 }), {
      reward_leaf_fixed: 0,
      reward_leaf_min: null,
      reward_leaf_max: null,
    });
    assert.deepEqual(rewardToColumns({ type: "none" }), {
      reward_leaf_fixed: null,
      reward_leaf_min: null,
      reward_leaf_max: null,
    });
    assert.deepEqual(rewardToColumns({ type: "range", min: 1, max: 5 }), {
      reward_leaf_fixed: null,
      reward_leaf_min: 1,
      reward_leaf_max: 5,
    });
  });

  it("rejects reverse range rewards", () => {
    const parsed = deedRewardInputSchema.safeParse({
      type: "range",
      min: 10,
      max: 1,
    });
    assert.equal(parsed.success, false);
  });

  it("rejects invalid evidence and accepts default draft shape", () => {
    assert.throws(
      () => normalizeEvidenceRequirements({}),
      (error: unknown) =>
        error instanceof DeedAuthoringError &&
        error.code === "invalid_evidence_requirements",
    );
    const ok = normalizeEvidenceRequirements(
      DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS,
    );
    assert.equal(ok.text.allowed, true);
    const parser = parseEvidenceRequirements(ok);
    assert.equal(parser.ok, true);
  });

  it("validates date window and rejects inverted range", () => {
    const ok = validateDateWindow(
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
    );
    assert.ok(ok.startsAt);
    assert.ok(ok.endsAt);
    assert.throws(
      () =>
        validateDateWindow(
          "2026-08-02T00:00:00.000Z",
          "2026-08-01T00:00:00.000Z",
        ),
      (error: unknown) =>
        error instanceof DeedAuthoringError &&
        error.code === "invalid_date_window",
    );
  });

  it("enforces lifecycle transitions", () => {
    assert.doesNotThrow(() => assertStatusTransition("draft", "active"));
    assert.doesNotThrow(() => assertStatusTransition("active", "closed"));
    assert.doesNotThrow(() => assertStatusTransition("closed", "archived"));
    assert.throws(
      () => assertStatusTransition("active", "draft"),
      (error: unknown) =>
        error instanceof DeedAuthoringError && error.code === "invalid_transition",
    );
    assert.throws(
      () => assertStatusTransition("archived", "active"),
      (error: unknown) =>
        error instanceof DeedAuthoringError && error.code === "invalid_transition",
    );
  });

  it("blocks common publish and non-draft edit", () => {
    assert.throws(
      () => assertPublishAccessScope("common"),
      (error: unknown) =>
        error instanceof DeedAuthoringError &&
        error.code === "common_not_available",
    );
    assert.equal(assertDraftEditable("draft"), "draft");
    assert.throws(
      () => assertDraftEditable("active"),
      (error: unknown) =>
        error instanceof DeedAuthoringError && error.code === "not_editable",
    );
  });

  it("slug helpers produce unique-ish draft slugs", () => {
    assert.equal(normalizeSlugCandidate(" Hello World "), "hello-world");
    assert.equal(normalizeSlugCandidate("   "), null);
    const a = generateDraftSlug("Test Deed");
    const b = generateDraftSlug("Test Deed");
    assert.match(a, /^test-deed-[a-z0-9]+$/);
    assert.notEqual(a, b);
  });

  it("create schema rejects unknown fields and requires title", () => {
    assert.equal(createDeedDraftSchema.safeParse({ title: "ok" }).success, true);
    assert.equal(
      createDeedDraftSchema.safeParse({ title: "ok", actorId: "x" }).success,
      false,
    );
    assert.equal(createDeedDraftSchema.safeParse({}).success, false);
    assert.equal(
      updateDeedDraftSchema.safeParse({ title: "edited" }).success,
      true,
    );
  });

  it("fixed reward may be zero; assertValidRewardForPublish allows none", () => {
    assert.doesNotThrow(() =>
      assertValidRewardForPublish({ type: "fixed", amount: 0 }),
    );
    assert.doesNotThrow(() => assertValidRewardForPublish({ type: "none" }));
  });
});

describe("Deed authoring + share-to-wall wiring", () => {
  it("Desk definition APIs require Desk access and never take client actor", () => {
    const routes = walkTs(join(repo, "src/app/api/desk/deeds")).filter(
      (p) => !p.includes(`${join("deeds", "submissions")}`),
    );
    assert.ok(routes.length >= 5);
    for (const abs of routes) {
      const source = readFileSync(abs, "utf8");
      assert.match(source, /requireFennDeskAccess/);
      assert.doesNotMatch(source, /body\.actorId|body\.admin|FENN_ADMIN_WALLETS/);
    }
  });

  it("authoring ops audit and use admin client; never awards LEAF", () => {
    const authoring = read("src/lib/deeds/authoring.ts");
    assert.match(authoring, /writeAdminAuditLog/);
    assert.match(authoring, /deed\.definition\.create/);
    assert.match(authoring, /deed\.definition\.publish/);
    assert.match(authoring, /deed\.definition\.close/);
    assert.match(authoring, /deed\.definition\.archive/);
    assert.match(authoring, /deed\.definition\.delete/);
    assert.match(authoring, /deed\.definition\.duplicate/);
    assert.doesNotMatch(authoring, /approve_deed_submission|awardLeaf|leaf_ledger/);
    assert.match(authoring, /createAdminClient|createAdminClient/);
  });

  it("share-to-wall uses writeFennWallEntry and does not insert wall_entries", () => {
    const share = read("src/lib/deeds/submission-wall.ts");
    assert.match(share, /writeFennWallEntry/);
    assert.match(share, /sourceType: "system"/);
    assert.match(share, /deed_submission:.*:wall|deedSubmissionWallSourceExternalId/);
    assert.doesNotMatch(share, /\.from\(["']wall_entries["']\)\s*\.insert/);
    assert.match(share, /deed\.submission\.share_to_wall/);
    assert.doesNotMatch(share, /approve_deed_submission|awardLeaf/);
    assert.doesNotMatch(share, /evidence_text|evidence_image_path/);
  });

  it("share route is Desk-gated under submissions namespace", () => {
    const route = read(
      "src/app/api/desk/deeds/submissions/[id]/share-to-wall/route.ts",
    );
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /shareApprovedSubmissionToWall/);
    assert.doesNotMatch(route, /requireFennAdmin/);
  });

  it("migration links submission to wall_entries", () => {
    const migration = read(
      "supabase/migrations/20260803190000_45_deed_submission_wall_link.sql",
    );
    assert.match(migration, /wall_entry_id/);
    assert.match(migration, /wall_entries/);
    assert.match(migration, /deed_submissions/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(migration, /ON DELETE SET NULL/);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|CREATE POLICY|GRANT INSERT/);
  });

  it("verify script exists for wall link migration", () => {
    const verify = read("supabase/verify_deed_submission_wall_link.sql");
    assert.match(verify, /wall_entry_id/);
    assert.match(verify, /deed_submissions_wall_entry_uidx/);
    assert.match(verify, /wall_entries/);
  });

  it("share-to-wall refuses to claim success when link is missing", () => {
    const share = read("src/lib/deeds/submission-wall.ts");
    assert.match(share, /could not be linked to the submission/);
    assert.match(share, /schema_not_ready|wall_entry_id/);
    assert.match(share, /is\("wall_entry_id", null\)/);
  });

  it("duplicate never copies common scope into a new draft", () => {
    const authoring = read("src/lib/deeds/authoring.ts");
    assert.match(authoring, /access_scope: accessScope/);
    assert.match(
      authoring,
      /source\.access_scope === "greenwood" \? "greenwood" : "road"/,
    );
    assert.match(authoring, /starts_at: null/);
    assert.match(authoring, /completions_count: 0/);
    assert.match(authoring, /published_at: null/);
  });

  it("stable wall provenance key", () => {
    assert.equal(
      deedSubmissionWallSourceExternalId(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ),
      "deed_submission:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:wall",
    );
  });

  it("regression: moderation and public listing paths unchanged as writers", () => {
    const moderation = read("src/lib/deeds/moderation-rpc.ts");
    assert.match(moderation, /approve_deed_submission|approveDeedSubmissionAtomic/);
    const queries = read("src/lib/deeds/queries.ts");
    assert.match(queries, /deeds_public_select|is_public|listPublicDeeds/);
    const wallWrite = read("src/lib/wall/write.ts");
    assert.match(wallWrite, /export async function writeFennWallEntry/);
  });

  it("desk submission detail exposes wallShare field", () => {
    const desk = read("src/lib/desk/deeds.ts");
    assert.match(desk, /wallShare/);
    assert.match(desk, /wall_entry_id/);
    const types = read("src/lib/desk/deeds-types.ts");
    assert.match(types, /wallShare/);
  });
});
