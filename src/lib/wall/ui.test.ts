import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatWallInscriptionTime } from "./format";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

describe("formatWallInscriptionTime", () => {
  it("formats UTC date and minutes without seconds", () => {
    assert.equal(
      formatWallInscriptionTime("2026-07-23T14:42:59.000Z"),
      "23 JUL 2026 — 14:42",
    );
  });
});

describe("Stage 10.5.2 Wall world surface", () => {
  it("desktop and mobile maps link [ the wall ] to /wall", () => {
    const map = readFileSync(
      join(repo, "src/content/home-world-map.ts"),
      "utf8",
    );
    assert.match(map, /label: "\[ the wall \]"/);
    assert.match(map, /href: "\/wall"/);
    assert.match(map, /c: "bone"/);
    assert.match(map, /\[ the wall \]/);
    const greenwoodBlock = map.indexOf("[ the greenwood ]");
    const wallInDesktopArt = map.indexOf('place("  [ the wall ]"');
    assert.ok(greenwoodBlock >= 0 && wallInDesktopArt >= 0);
    assert.ok(wallInDesktopArt > greenwoodBlock);
    assert.match(map, /MOBILE_LINES[\s\S]*\[ the wall \]/);
  });

  it("Old Directory lists The Wall", () => {
    const dir = readFileSync(
      join(repo, "src/components/home/home-paths.tsx"),
      "utf8",
    );
    assert.match(dir, /label: "the wall"/);
    assert.match(dir, /href: "\/wall"/);
    assert.match(dir, /only fenn writes here/);
  });

  it("/wall page uses public read layer and has no composer", () => {
    assert.equal(existsSync(join(repo, "src/app/wall/page.tsx")), true);
    const page = readFileSync(join(repo, "src/app/wall/page.tsx"), "utf8");
    assert.match(page, /listPublicWallEntries/);
    assert.match(page, /force-dynamic/);
    assert.doesNotMatch(page, /<textarea|<input|writeFennWallEntry|createBrowserClient/);
    assert.doesNotMatch(page, /"use client"/);
    assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(page, /openai|fenn_memories|memory_candidates|embedding/i);
    assert.doesNotMatch(page, /x\.com|twitter|ask fenn/i);
    assert.match(page, /the wall cannot be read just now/);
    assert.match(page, /only fenn writes here/);
  });

  it("inscriptions preserve body, anchors, and empty vs error wording", () => {
    const ui = readFileSync(
      join(repo, "src/components/wall/wall-inscriptions.tsx"),
      "utf8",
    );
    assert.match(ui, /id=\{entry\.id\}/);
    assert.match(ui, /formatWallInscriptionTime/);
    assert.match(ui, /<time dateTime=\{entry\.createdAt\}/);
    assert.match(ui, /wall-entry__body/);
    assert.match(ui, /nothing has been left|the wall is bare/);
    assert.doesNotMatch(ui, /cannot be read/);
    assert.doesNotMatch(ui, /dangerouslySetInnerHTML|textarea/);
    assert.doesNotMatch(ui, /rounded|shadow|card|glass|gradient/i);
  });

  it("no public Wall write POST and write remains server-only", () => {
    assert.equal(existsSync(join(repo, "src/app/api/wall/route.ts")), false);
    const write = readFileSync(join(here, "write.ts"), "utf8");
    assert.match(write, /server-only/);
    assert.match(write, /createAdminClient/);
  });

  it("WALL title mark and bone accent exist", () => {
    const titles = readFileSync(
      join(repo, "src/content/ascii-page-titles.ts"),
      "utf8",
    );
    assert.match(titles, /WALL: renderAsciiMark\("WALL"\)/);
    assert.match(titles, /\| "wall"/);

    const css = readFileSync(join(repo, "src/app/globals.css"), "utf8");
    assert.match(css, /\.ascii-page-title--wall/);
    assert.match(css, /\.wall-entry__body/);
    assert.match(css, /scroll-margin-top/);
    assert.match(css, /white-space:\s*pre-wrap/);
  });
});

describe("Stage 10.5.3 Leave a Mark UI", () => {
  it("shows LEAVE A MARK / MARK LEFT / TRY AGAIN without likes language", () => {
    const ui = readFileSync(
      join(repo, "src/components/wall/wall-inscriptions.tsx"),
      "utf8",
    );
    assert.match(ui, /LEAVE A MARK/);
    assert.match(ui, /MARK LEFT/);
    assert.match(ui, /TRY AGAIN/);
    assert.match(ui, /LEAVING A MARK/);
    assert.match(ui, /postLeaveWallMark/);
    assert.match(ui, /fetchWallMarksStatus/);
    assert.match(ui, /login\(\)/);
    assert.match(ui, /\/#outlaw-register/);
    assert.doesNotMatch(ui, /\blike\b|\bupvote\b|\bemoji\b|textarea|\bcomment\b/i);
    assert.doesNotMatch(ui, /greenwood_entered|awardLeaf|leaf_ledger/i);
  });

  it("count remains a plain integer display", () => {
    const ui = readFileSync(
      join(repo, "src/components/wall/wall-inscriptions.tsx"),
      "utf8",
    );
    assert.match(ui, /String\(count\)/);
    assert.doesNotMatch(ui, /1K|abbreviat|avatar/i);
  });

  it("CSS styles mark action without card chrome", () => {
    const css = readFileSync(join(repo, "src/app/globals.css"), "utf8");
    assert.match(css, /\.wall-entry__mark/);
    assert.match(css, /\.wall-mark__count/);
  });
});
