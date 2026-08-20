import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deskManualWallSourceExternalId,
  validateDeskWallInscriptionBody,
} from "@/lib/desk/wall-inscribe";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("desk wall inscription helpers", () => {
  it("accepts plain text and rejects HTML / empty / overlong", () => {
    assert.equal(
      validateDeskWallInscriptionBody("  the wood listens.  "),
      "the wood listens.",
    );
    assert.throws(() => validateDeskWallInscriptionBody("   "), /required/);
    assert.throws(() => validateDeskWallInscriptionBody("<b>no</b>"), /HTML/);
    assert.throws(
      () => validateDeskWallInscriptionBody("a".repeat(WALL_BODY_MAX_CHARS + 1)),
      /at most/,
    );
  });

  it("uses unique desk:manual provenance", () => {
    const a = deskManualWallSourceExternalId(
      "11111111-1111-4111-8111-111111111111",
    );
    const b = deskManualWallSourceExternalId(
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(a, "desk:manual:11111111-1111-4111-8111-111111111111");
    assert.notEqual(a, b);
  });
});

describe("desk wall surface wiring", () => {
  it("routes through requireFennDeskAccess and writeFennWallEntry only", () => {
    const route = read("src/app/api/desk/wall/route.ts");
    const lib = read("src/lib/desk/wall-inscribe.ts");
    const panel = read("src/components/desk/desk-wall-panel.tsx");
    const page = read("src/app/desk/wall/page.tsx");
    const gate = read("src/components/desk/desk-gate.tsx");

    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /deskInscribeWall/);
    assert.match(route, /listPublicWallEntries/);
    assert.doesNotMatch(route, /\.from\("wall_entries"\)\.insert/);

    assert.match(lib, /writeFennWallEntry/);
    assert.match(lib, /sourceType:\s*"system"/);
    assert.match(lib, /desk:manual:/);
    assert.match(lib, /writeAdminAuditLog/);
    assert.doesNotMatch(lib, /\.from\("wall_entries"\)\.insert/);

    assert.match(panel, /\/api\/desk\/wall/);
    assert.match(panel, /\[ confirm inscription \]/);
    assert.match(page, /DeskWallPanel/);
    assert.match(gate, /href="\/desk\/wall"/);
    assert.match(gate, /The Wall/);
  });

  it("does not invent a public wall create API", () => {
    assert.equal(existsSync(join(repo, "src/app/api/wall/route.ts")), false);
  });
});
