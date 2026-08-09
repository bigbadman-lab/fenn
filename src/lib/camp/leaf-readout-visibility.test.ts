import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { shouldShowCampLeafReadout } from "@/lib/camp/leaf-readout-visibility";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const registered = {
  privyReady: true,
  authenticated: true,
  profileResolved: true,
  registered: true,
  hasProfile: true,
} as const;

describe("shouldShowCampLeafReadout", () => {
  it("logged-out visitor → personal LEAF section hidden", () => {
    assert.equal(
      shouldShowCampLeafReadout({
        privyReady: true,
        authenticated: false,
        profileResolved: true,
        registered: false,
        hasProfile: false,
      }),
      false,
    );
  });

  it("auth / profile unresolved → personal LEAF section hidden", () => {
    assert.equal(
      shouldShowCampLeafReadout({
        privyReady: false,
        authenticated: false,
        profileResolved: false,
        registered: false,
        hasProfile: false,
      }),
      false,
    );
    assert.equal(
      shouldShowCampLeafReadout({
        privyReady: true,
        authenticated: true,
        profileResolved: false,
        registered: false,
        hasProfile: false,
      }),
      false,
    );
  });

  it("authenticated but unregistered → no LEAF: 0 placeholder chrome", () => {
    assert.equal(
      shouldShowCampLeafReadout({
        privyReady: true,
        authenticated: true,
        profileResolved: true,
        registered: false,
        hasProfile: false,
      }),
      false,
    );
  });

  it("registered Outlaw → personal LEAF section visible (including 0 LEAF)", () => {
    assert.equal(shouldShowCampLeafReadout(registered), true);
  });
});

describe("CampLeafReadout gate contract", () => {
  const readout = read("src/components/camp/camp-leaf-readout.tsx");
  const ground = read("src/components/camp/camp-ground.tsx");

  it("uses FennAuth + shouldShowCampLeafReadout; no guest LEAF chrome", () => {
    assert.match(readout, /useFennAuth/);
    assert.match(readout, /shouldShowCampLeafReadout/);
    assert.match(readout, /return null/);
    assert.doesNotMatch(readout, /LEAF:\s*<span className="muted">—<\/span>/);
    assert.doesNotMatch(readout, /checking\.\.\./);
    assert.doesNotMatch(readout, /not yet written in the register/);
    assert.doesNotMatch(readout, /camp-leaf">0<\/span>/);
    assert.doesNotMatch(readout, /fetch\(/);
    assert.doesNotMatch(readout, /\/api\/ledger/);
  });

  it("registered path preserves OUTLAW + profile.leafBalance readout", () => {
    assert.match(
      readout,
      /OUTLAW \{formatOutlawNumber\(profile\.outlawNumber\)\}/,
    );
    assert.match(
      readout,
      /LEAF: <span className="camp-leaf">\{profile\.leafBalance\}<\/span>/,
    );
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
