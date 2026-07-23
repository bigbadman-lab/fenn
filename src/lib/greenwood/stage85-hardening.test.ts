import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateDeedAccessScope } from "@/lib/deeds/rules";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const srcRoot = join(repoRoot, "src");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walkTsFiles(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("evaluateDeedAccessScope (Stage 8.5)", () => {
  it("allows Road for anyone", () => {
    assert.deepEqual(
      evaluateDeedAccessScope("road", { greenwoodEnteredAt: null }),
      { allowed: true },
    );
  });

  it("requires permanent membership for Greenwood Deeds", () => {
    assert.deepEqual(
      evaluateDeedAccessScope("greenwood", { greenwoodEnteredAt: null }),
      { allowed: false, reason: "greenwood_membership_required" },
    );
    assert.deepEqual(
      evaluateDeedAccessScope("greenwood", {
        greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      }),
      { allowed: true },
    );
  });

  it("keeps Common Deeds deferred", () => {
    assert.deepEqual(
      evaluateDeedAccessScope("common", {
        greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      }),
      { allowed: false, reason: "common_not_available_yet" },
    );
  });
});

describe("Stage 8.5 Greenwood hardening source safety", () => {
  it("removes Stage 5 holding placeholders from live UI", () => {
    const gate = readFileSync(
      join(srcRoot, "components/greenwood/greenwood-gate.tsx"),
      "utf8",
    );
    const gateway = readFileSync(
      join(srcRoot, "components/greenwood/greenwood-gateway.tsx"),
      "utf8",
    );
    const member = readFileSync(
      join(srcRoot, "components/greenwood/greenwood-member.tsx"),
      "utf8",
    );
    assert.doesNotMatch(gate, /THE GATE IS NOT YET LISTENING/);
    assert.doesNotMatch(gate, /GreenwoodGateHoldingMessage/);
    assert.doesNotMatch(gate, /deeper paths are still being cut/);
    assert.doesNotMatch(gateway, /GreenwoodGateHoldingMessage/);
    assert.doesNotMatch(gateway, /GreenwoodGateInterior/);
    assert.match(member, /GreenwoodMember/);
    assert.match(member, /THE NOTICE TREE/);
    assert.match(member, /cold for now/);
  });

  it("crossing final hold remains 2000ms", () => {
    const frames = readFileSync(
      join(srcRoot, "components/greenwood/greenwood-frames.ts"),
      "utf8",
    );
    assert.match(frames, /holdMs:\s*2000/);
    assert.match(frames, /THE ROAD ENDS HERE/);
  });

  it("client components do not hardcode threshold eligibility", () => {
    const components = walkTsFiles(join(srcRoot, "components/greenwood"));
    for (const file of components) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /leafLifetimeEarned\s*>=/);
      assert.doesNotMatch(source, /lifetimeLeaf\s*>=\s*30/);
      assert.doesNotMatch(source, /threshold\s*=\s*30/);
    }
  });

  it("application TS does not mutate Greenwood admission fields via client updates", () => {
    const files = walkTsFiles(srcRoot);
    for (const file of files) {
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(
        source,
        /\.update\(\s*\{[\s\S]*?greenwood_entered_at\s*:/,
        `forbidden .update greenwood_entered_at in ${file}`,
      );
      assert.doesNotMatch(
        source,
        /\.update\(\s*\{[\s\S]*?greenwood_threshold_at_entry\s*:/,
        `forbidden .update greenwood_threshold_at_entry in ${file}`,
      );
      assert.doesNotMatch(
        source,
        /\.update\(\s*\{[\s\S]*?greenwood_lifetime_leaf_at_entry\s*:/,
        `forbidden .update greenwood_lifetime_leaf_at_entry in ${file}`,
      );
      assert.doesNotMatch(
        source,
        /\.insert\(\s*\{[\s\S]*?greenwood_entered_at\s*:/,
        `forbidden .insert greenwood_entered_at in ${file}`,
      );
    }

    const admission = readFileSync(
      join(srcRoot, "lib/greenwood/admission.ts"),
      "utf8",
    );
    assert.match(admission, /admit_to_greenwood/);
    assert.match(admission, /p_profile_id:\s*id/);
  });

  it("enter API rejects body profile authority and uses Privy profile id", () => {
    const enter = readFileSync(
      join(srcRoot, "app/api/greenwood/enter/route.ts"),
      "utf8",
    );
    assert.match(enter, /getVerifiedPrivyUser/);
    assert.match(enter, /findProfileByPrivyUserId/);
    assert.match(enter, /admitProfileToGreenwood\(profile\.id/);
    assert.match(enter, /Request body must be empty/);
  });

  it("Deed routes pass verified profile membership, not body fields", () => {
    const submissions = readFileSync(
      join(srcRoot, "app/api/deeds/[id]/submissions/route.ts"),
      "utf8",
    );
    const image = readFileSync(
      join(srcRoot, "app/api/deeds/[id]/evidence/image/route.ts"),
      "utf8",
    );
    assert.match(submissions, /greenwoodEnteredAt:\s*profile\.greenwood_entered_at/);
    assert.match(image, /greenwoodEnteredAt:\s*profile\.greenwood_entered_at/);
    assert.doesNotMatch(submissions, /parsed\.data\.greenwoodEnteredAt/);
    assert.doesNotMatch(image, /body\.greenwoodEnteredAt/);
  });
});
