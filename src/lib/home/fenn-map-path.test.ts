import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FENN_ASCII_DETAILED,
  FENN_ASCII_MAP_A,
  FENN_ASCII_MAP_B,
  FENN_ASCII_MAP_COMPACT_A,
  fennMapAscii,
} from "../../content/fenn-ascii";
import {
  assertRouteClearance,
  assertRouteGraphIntegrity,
  assertWaypointClearance,
  atmosphericLineFor,
  chooseNextDestination,
  FENN_IDLE_FOOTPRINT,
  FENN_MAP_CELLS,
  FENN_MAP_IDLE_WAYPOINTS,
  FENN_MAP_WAYPOINTS,
  findClearPath,
  interpolatePoint,
  isGreenwoodSpecialVisit,
  isRectClear,
  isRouteValid,
  mapGrid,
  mapWidth,
  mulberry32,
  neighborsOf,
  pathBetweenWaypoints,
  shouldRunWanderTimers,
  type FennMapWaypointId,
} from "./fenn-map-path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

describe("canonical FENN ASCII", () => {
  it("detailed character keeps hat, eyes, fenn label, and legs", () => {
    assert.match(FENN_ASCII_DETAILED, /\/---\\/);
    assert.match(FENN_ASCII_DETAILED, /o\s+o/);
    assert.match(FENN_ASCII_DETAILED, /f e n n/);
    assert.match(FENN_ASCII_DETAILED, /\(_\)\s*\(_\)/);
    assert.match(FENN_ASCII_DETAILED, /\/--\//);
  });

  it("map variants share recognisable features and walking poses differ", () => {
    assert.match(FENN_ASCII_MAP_A, /\/---\\/);
    assert.match(FENN_ASCII_MAP_A, /fenn/);
    assert.match(FENN_ASCII_MAP_COMPACT_A, /o o/);
    assert.notEqual(FENN_ASCII_MAP_A, FENN_ASCII_MAP_B);
    assert.equal(fennMapAscii("desktop", "a"), FENN_ASCII_MAP_A);
    assert.equal(fennMapAscii("mobile", "a"), FENN_ASCII_MAP_COMPACT_A);
  });
});

describe("fenn map waypoints and routes", () => {
  it("defines waypoints for all living destinations on both variants", () => {
    const expected: FennMapWaypointId[] = [
      "book",
      "oak",
      "camp",
      "deeds",
      "ledger",
      "commons",
      "wall",
      "greenwood",
      "greenwood_gate",
    ];
    for (const variant of ["desktop", "mobile"] as const) {
      for (const id of expected) {
        const p = FENN_MAP_WAYPOINTS[variant][id];
        assert.ok(p.x >= 0 && p.x <= 100);
        assert.ok(p.y >= 0 && p.y <= 100);
      }
    }
    assert.deepEqual([...FENN_MAP_IDLE_WAYPOINTS].sort(), [
      "book",
      "camp",
      "commons",
      "deeds",
      "greenwood",
      "ledger",
      "oak",
      "wall",
    ]);
  });

  it("route graph is valid and Greenwood is reachable", () => {
    assert.equal(assertRouteGraphIntegrity(), true);
    assert.equal(isRouteValid("camp", "greenwood"), true);
    assert.equal(isRouteValid("deeds", "greenwood"), true);
    assert.equal(isRouteValid("book", "commons"), false);
    assert.ok(neighborsOf("greenwood_gate").includes("greenwood"));
    assert.equal(isGreenwoodSpecialVisit("greenwood"), true);
    assert.equal(isGreenwoodSpecialVisit("camp"), false);
  });

  it("chooseNextDestination stays on the route graph", () => {
    const rand = mulberry32(42);
    for (const start of FENN_MAP_IDLE_WAYPOINTS) {
      for (let i = 0; i < 20; i += 1) {
        const { target } = chooseNextDestination(start, rand);
        assert.equal(isRouteValid(start, target), true);
      }
    }
  });

  it("interpolatePoint stays between endpoints", () => {
    const mid = interpolatePoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5);
    assert.deepEqual(mid, { x: 5, y: 10 });
  });

  it("idle pads and travel paths only occupy empty ASCII cells", () => {
    for (const variant of ["desktop", "mobile"] as const) {
      assert.equal(assertWaypointClearance(variant), true);
      assert.equal(assertRouteClearance(variant), true);
      const grid = mapGrid(variant);
      const width = mapWidth(variant);
      const idle = FENN_IDLE_FOOTPRINT[variant];
      for (const id of Object.keys(FENN_MAP_CELLS[variant]) as FennMapWaypointId[]) {
        assert.equal(
          isRectClear(grid, width, FENN_MAP_CELLS[variant][id], idle.rows, idle.cols),
          true,
          `${variant}/${id}`,
        );
      }
      const path = pathBetweenWaypoints(variant, "camp", "greenwood");
      assert.ok(path.length >= 2);
      const full = findClearPath(
        variant,
        FENN_MAP_CELLS[variant].camp,
        FENN_MAP_CELLS[variant].greenwood,
      );
      assert.ok(full);
      for (const cell of full!) {
        assert.equal(grid[cell.row]![cell.col], " ");
      }
    }
  });

  it("atmospheric lines never claim server-side judgement", () => {
    const lines = [
      atmosphericLineFor("idle", "camp"),
      atmosphericLineFor("walking", "deeds"),
      atmosphericLineFor("greenwood_linger", "greenwood"),
    ];
    for (const line of lines) {
      assert.ok(line);
      assert.doesNotMatch(line, /judg|LEAF|award|execut|reply/i);
    }
  });

  it("prefers-reduced-motion and hidden tabs stop wander timers", () => {
    assert.equal(
      shouldRunWanderTimers({ documentVisible: true, reduceMotion: false }),
      true,
    );
    assert.equal(
      shouldRunWanderTimers({ documentVisible: false, reduceMotion: false }),
      false,
    );
    assert.equal(
      shouldRunWanderTimers({ documentVisible: true, reduceMotion: true }),
      false,
    );
  });
});

describe("living map does not couple to world systems", () => {
  it("wanderer is decorative overlay with pointer-events none", () => {
    const wanderer = readFileSync(
      join(repo, "src/components/home/fenn-map-wanderer.tsx"),
      "utf8",
    );
    const css = readFileSync(join(repo, "src/app/globals.css"), "utf8");
    const map = readFileSync(
      join(repo, "src/components/home/fenn-world-map.tsx"),
      "utf8",
    );

    assert.match(wanderer, /"use client"/);
    assert.match(wanderer, /aria-hidden="true"/);
    assert.doesNotMatch(wanderer, /fetch\(|supabase|createClient|router\.push/i);
    assert.doesNotMatch(wanderer, /stage12|judge|leaf_ledger|world-pulse/i);
    assert.match(css, /\.fenn-map__wanderer[\s\S]*pointer-events:\s*none/);
    assert.match(map, /FennMapWanderer/);
    assert.match(map, /aria-label="map of fenn"/);
  });

  it("existing destination links remain intact", () => {
    const map = readFileSync(
      join(repo, "src/content/home-world-map.ts"),
      "utf8",
    );
    for (const label of [
      "[ the book ]",
      "[ the oak ]",
      "[ the greenwood ]",
      "[ deeds ]",
      "[ the camp ]",
      "[ the ledger ]",
      "[ the commons ]",
      "[ the wall ]",
    ]) {
      assert.ok(map.includes(`label: "${label}"`), label);
    }
    assert.match(map, /href: "\/greenwood\?crossing=1"/);
    assert.match(map, /href: "\/wall"/);
  });

  it("welcome arrival transmission is locked and compact", () => {
    const welcome = readFileSync(
      join(repo, "src/components/home/home-welcome.tsx"),
      "utf8",
    );
    const page = readFileSync(join(repo, "src/app/page.tsx"), "utf8");
    const copy = readFileSync(join(repo, "src/content/welcome.ts"), "utf8");
    const map = readFileSync(
      join(repo, "src/components/home/fenn-world-map.tsx"),
      "utf8",
    );

    assert.match(welcome, /HOMEPAGE_WELCOME/);
    assert.match(welcome, /href="#the-map"/);
    assert.doesNotMatch(welcome, /FENN_ASCII_DETAILED/);
    assert.doesNotMatch(welcome, /CANONICAL_WELCOME_TEXT/);
    assert.match(copy, /WELCOME, OUTLAW\./);
    assert.match(copy, /\[ ENTER THE MAP \]/);
    assert.match(copy, /This is not a game\. This is how a world remembers\./);
    assert.match(map, /id="the-map"/);

    const welcomeOrder = page.indexOf("<HomeWelcome");
    const identityOrder = page.indexOf("<HomeIdentity");
    const voiceOrder = page.indexOf("<HomeFennVoice");
    assert.ok(welcomeOrder >= 0 && identityOrder > welcomeOrder);
    assert.ok(voiceOrder > identityOrder);

    const voice = readFileSync(
      join(repo, "src/components/home/home-fenn-voice.tsx"),
      "utf8",
    );
    assert.match(voice, /CANONICAL_WELCOME_TEXT/);
  });

  it("path module does not write to the database or Stage 12", () => {
    const path = readFileSync(
      join(repo, "src/lib/home/fenn-map-path.ts"),
      "utf8",
    );
    assert.doesNotMatch(path, /supabase|fetch\(|createClient|rpc\(/i);
    assert.doesNotMatch(path, /stage12|judgement|leaf_ledger/i);
  });
});
