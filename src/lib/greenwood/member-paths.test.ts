import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GREENWOOD_MEMBER_PATHS,
  memberInteriorCopy,
} from "./member-paths";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../../app");
const componentsRoot = join(here, "../../components/greenwood");

describe("memberInteriorCopy", () => {
  it("shows Outlaw identity and frozen entry LEAF without eligibility UI", () => {
    const copy = memberInteriorCopy({
      outlawLabel: "OUTLAW 00042",
      alias: "rook",
      member: {
        greenwoodEnteredAt: "2026-07-23T12:00:00.000Z",
        thresholdAtEntry: 30,
        lifetimeLeafAtEntry: 34,
      },
    });
    assert.equal(copy.outlawLabel, "OUTLAW 00042");
    assert.equal(copy.aliasLine, "known as rook");
    assert.equal(
      copy.entryLeafLine,
      "entered the wood with 34 lifetime LEAF.",
    );
    assert.equal(copy.showsEligibility, false);
    assert.equal(copy.showsEnter, false);
  });

  it("omits alias line when alias is empty", () => {
    const copy = memberInteriorCopy({
      outlawLabel: "OUTLAW 00007",
      alias: "   ",
      member: {
        greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
        thresholdAtEntry: 30,
        lifetimeLeafAtEntry: 30,
      },
    });
    assert.equal(copy.aliasLine, null);
  });
});

describe("GREENWOOD_MEMBER_PATHS", () => {
  it("links only existing FENN routes", () => {
    const hrefs = GREENWOOD_MEMBER_PATHS.map((path) => path.href);
    assert.deepEqual(hrefs, [
      "/camp",
      "/deeds",
      "/book",
      "/oak",
      "/ledger",
      "/commons",
    ]);
    for (const href of hrefs) {
      const pagePath = join(appRoot, href.slice(1), "page.tsx");
      assert.equal(existsSync(pagePath), true, `missing page for ${href}`);
    }
  });

  it("does not invent routes", () => {
    for (const path of GREENWOOD_MEMBER_PATHS) {
      assert.doesNotMatch(path.href, /treasury|circulation|fire|notice/i);
    }
  });
});

describe("greenwood member source safety", () => {
  it("member component stays free of Stage 9+ systems", () => {
    const source = readFileSync(
      join(componentsRoot, "greenwood-member.tsx"),
      "utf8",
    );
    assert.match(source, /THE PATHS/);
    assert.match(source, /THE NOTICE TREE/);
    assert.match(source, /the tree is quiet/);
    assert.match(source, /THE FIRE/);
    assert.match(source, /cold for now/);
    assert.match(source, /lifetimeLeafAtEntry/);
    assert.doesNotMatch(source, /ENTER THE GREENWOOD/);
    assert.doesNotMatch(source, /LEAF REMAIN/);
    assert.doesNotMatch(source, /remainingLeaf/);
    assert.doesNotMatch(source, /from ["']@\/lib\/leaf\/standing/);
    assert.doesNotMatch(source, /from ["']@\/lib\/treasury/);
    assert.doesNotMatch(source, /from ["']@\/lib\/commons/);
    assert.doesNotMatch(source, /from ["']@\/lib\/circulation/);
    assert.doesNotMatch(source, /memory_candidate|fenn_memories|embedding/);
    assert.doesNotMatch(source, /supabase\.channel|WebSocket/);
    assert.doesNotMatch(source, /chronicle_entries/);
  });

  it("crossing frames remain unchanged at 2000ms final hold", () => {
    const frames = readFileSync(
      join(componentsRoot, "greenwood-frames.ts"),
      "utf8",
    );
    assert.match(frames, /holdMs:\s*2000/);
  });
});
