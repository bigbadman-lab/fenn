import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { shouldShowCampLeafReadout } from "@/lib/camp/leaf-readout-visibility";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("shouldShowCampLeafReadout", () => {
  it("logged-out visitor → personal LEAF section hidden", () => {
    assert.equal(
      shouldShowCampLeafReadout({ privyReady: true, authenticated: false }),
      false,
    );
  });

  it("auth unresolved (Privy not ready) → personal LEAF section hidden", () => {
    assert.equal(
      shouldShowCampLeafReadout({ privyReady: false, authenticated: false }),
      false,
    );
    // Must not flash guest LEAF while session may still resolve authenticated.
    assert.equal(
      shouldShowCampLeafReadout({ privyReady: false, authenticated: true }),
      false,
    );
  });

  it("logged-in user → personal LEAF section visible (including 0 LEAF)", () => {
    assert.equal(
      shouldShowCampLeafReadout({ privyReady: true, authenticated: true }),
      true,
    );
  });
});

describe("CampLeafReadout gate contract", () => {
  const readout = read("src/components/camp/camp-leaf-readout.tsx");
  const ground = read("src/components/camp/camp-ground.tsx");

  it("uses FennAuth + shouldShowCampLeafReadout; no guest dash LEAF placeholder", () => {
    assert.match(readout, /useFennAuth/);
    assert.match(readout, /shouldShowCampLeafReadout/);
    assert.match(readout, /return null/);
    assert.doesNotMatch(readout, /LEAF:\s*<span className="muted">—<\/span>/);
    assert.doesNotMatch(readout, /fetch\(/);
    assert.doesNotMatch(readout, /\/api\/ledger/);
  });

  it("authenticated paths preserve 0 LEAF and profile balance readout", () => {
    assert.match(readout, /LEAF: <span className="camp-leaf">0<\/span>/);
    assert.match(
      readout,
      /LEAF: <span className="camp-leaf">\{profile\.leafBalance\}<\/span>/,
    );
    assert.match(readout, /checking\.\.\./);
    assert.match(readout, /not yet written in the register/);
    assert.match(readout, /OUTLAW \{formatOutlawNumber\(profile\.outlawNumber\)\}/);
  });

  it("Camp still mounts CampLeafReadout under leaf note (lore stays public)", () => {
    assert.match(ground, /CampLeafReadout/);
    assert.equal((ground.match(/<CampLeafReadout/g) ?? []).length, 1);
    assert.match(ground, /LEAF CAN BE FOUND HERE/);
    assert.match(
      ground,
      /camp__intro[\s\S]*camp__leaf-note[\s\S]*CampLeafReadout/,
    );
  });
});
