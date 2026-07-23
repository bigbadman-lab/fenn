import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FOUNDING_WALL_INSCRIPTION_BODY,
  foundingWallWriteInput,
} from "./bootstrap";
import {
  STAGE12_WALL_MODEL_FORBIDDEN_FIELDS,
  STAGE12_WALL_SAFETY_REQUIREMENTS,
  STAGE12_WRITE_TO_WALL_TOOL,
  stage12WallSourceExternalId,
  stage12WallWriteInput,
  wallPermalinkAbsolute,
  wallPermalinkPath,
} from "./stage12-tool-contract";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const srcRoot = join(repo, "src");

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

describe("Stage 10.5.4 Wall hardening — authorship", () => {
  it("application wall_entries inserts only exist in writeFennWallEntry", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(srcRoot)) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const rel = file.slice(srcRoot.length + 1);
      const source = readFileSync(file, "utf8");
      if (!source.includes("wall_entries")) continue;
      if (
        !/\.from\(\s*["']wall_entries["']\s*\)[\s\S]{0,200}\.insert\(/.test(
          source,
        )
      ) {
        continue;
      }
      if (rel === join("lib", "wall", "write.ts")) continue;
      offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
  });

  it("no public Wall write POST; mark routes are mark-only", () => {
    assert.equal(existsSync(join(repo, "src/app/api/wall/route.ts")), false);
    const mark = readFileSync(
      join(repo, "src/app/api/wall/[entryId]/mark/route.ts"),
      "utf8",
    );
    assert.match(mark, /export async function POST/);
    assert.doesNotMatch(mark, /writeFennWallEntry/);
    assert.doesNotMatch(mark, /export async function (DELETE|PUT|PATCH)/);
  });

  it("Wall UI and page have no composer / HTML injection", () => {
    const page = readFileSync(join(repo, "src/app/wall/page.tsx"), "utf8");
    const ui = readFileSync(
      join(repo, "src/components/wall/wall-inscriptions.tsx"),
      "utf8",
    );
    for (const source of [page, ui]) {
      assert.doesNotMatch(source, /<textarea|<input type=["']text/);
      assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
      assert.doesNotMatch(source, /writeFennWallEntry|createBrowserClient/);
      assert.doesNotMatch(source, /\bshare\b|\bavatar\b|\bupvote\b/i);
      assert.doesNotMatch(source, /\blikes?\b|\bliked\b/i);
    }
  });
});

describe("Stage 10.5.4 Wall hardening — provenance + privacy", () => {
  it("hardening migration limits browser SELECT to id/body/created_at", () => {
    const sql = readFileSync(
      join(
        repo,
        "supabase/migrations/20260723180000_19_stage105_wall_hardening.sql",
      ),
      "utf8",
    );
    assert.match(sql, /REVOKE SELECT ON TABLE public\.wall_entries/);
    assert.match(sql, /GRANT SELECT \(id, body, created_at\)/);
    assert.doesNotMatch(sql, /GRANT SELECT \(.*source_type/);
  });

  it("public DTO shape is id/body/createdAt/markCount only", () => {
    const types = readFileSync(join(here, "types.ts"), "utf8");
    const match = types.match(
      /export type PublicWallEntry = \{([^}]+)\}/,
    );
    assert.ok(match);
    const body = match[1] ?? "";
    assert.match(body, /\bid:\s*string/);
    assert.match(body, /\bbody:\s*string/);
    assert.match(body, /\bcreatedAt:\s*string/);
    assert.match(body, /\bmarkCount:\s*number/);
    assert.doesNotMatch(body, /sourceType|sourceExternalId|profileId/);
  });

  it("Wall modules do not import RAG/X/LEAF/Greenwood", () => {
    for (const name of [
      "read.ts",
      "write.ts",
      "marks.ts",
      "client.ts",
      "format.ts",
      "bootstrap.ts",
      "stage12-tool-contract.ts",
    ]) {
      const source = readFileSync(join(here, name), "utf8");
      assert.doesNotMatch(
        source,
        /from ["']@\/lib\/leaf|from ["']@\/lib\/greenwood|fenn_memories|memory_candidates/,
      );
      assert.doesNotMatch(
        source,
        /from ["']openai|twitter-api|x\.com\/oauth/i,
      );
    }
  });
});

describe("Stage 10.5.4 founding bootstrap (ops-only)", () => {
  it("documents founding copy without auto-seeding routes", () => {
    assert.match(
      FOUNDING_WALL_INSCRIPTION_BODY,
      /this wall was here before the road/,
    );
    assert.match(
      FOUNDING_WALL_INSCRIPTION_BODY,
      /i only recently learned how to write on it/,
    );
    const input = foundingWallWriteInput();
    assert.equal(input.sourceType, "bootstrap");
    assert.equal(input.sourceExternalId, "founding:stage105");

    const example = readFileSync(
      join(repo, "supabase/examples/stage105_wall_bootstrap_example.sql"),
      "utf8",
    );
    assert.match(example, /Do NOT apply as a migration/);
    assert.match(example, /Application code must NOT auto-seed/);

    const page = readFileSync(join(repo, "src/app/wall/page.tsx"), "utf8");
    assert.doesNotMatch(page, /foundingWallWriteInput|FOUNDING_WALL/);
    assert.doesNotMatch(page, /writeFennWallEntry/);
  });
});

describe("Stage 12 Wall tool contract (doc only)", () => {
  it("locks sourceType to x_agent and scopes external id", () => {
    assert.equal(STAGE12_WRITE_TO_WALL_TOOL, "write_to_wall");
    const input = stage12WallWriteInput({
      body: "look at the wall.",
      sourceExternalId: stage12WallSourceExternalId("1234567890"),
    });
    assert.deepEqual(input, {
      body: "look at the wall.",
      sourceType: "x_agent",
      sourceExternalId: "1234567890:wall",
    });
    assert.ok(STAGE12_WALL_MODEL_FORBIDDEN_FIELDS.includes("sourceType"));
    assert.ok(STAGE12_WALL_SAFETY_REQUIREMENTS.length >= 6);
  });

  it("builds stable permalink paths without inventing origin", () => {
    assert.equal(
      wallPermalinkPath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      "/wall#aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    assert.equal(
      wallPermalinkAbsolute("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", null),
      null,
    );
    assert.equal(
      wallPermalinkAbsolute(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "https://fenn.example/",
      ),
      "https://fenn.example/wall#aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("is not registered as a live OpenAI tool anywhere in src", () => {
    for (const file of walkTsFiles(srcRoot)) {
      if (file.endsWith(".test.ts")) continue;
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /tools:\s*\[[^\]]*write_to_wall/);
      assert.doesNotMatch(source, /registerTool\(['"]write_to_wall/);
    }
  });
});

describe("Stage 10.5.4 world surface regressions", () => {
  it("map keeps wall outside Greenwood near the road", () => {
    const map = readFileSync(
      join(repo, "src/content/home-world-map.ts"),
      "utf8",
    );
    assert.match(map, /label: "\[ the wall \]"/);
    assert.match(map, /href: "\/wall"/);
    assert.match(map, /by the road|by road/);
    const greenwood = map.indexOf("[ the greenwood ]");
    const wallArt = map.indexOf('place("  [ the wall ]"');
    assert.ok(greenwood >= 0 && wallArt > greenwood);
  });

  it("Old Directory keeps concise FENN-only copy", () => {
    const dir = readFileSync(
      join(repo, "src/components/home/home-paths.tsx"),
      "utf8",
    );
    assert.match(dir, /number: "08"/);
    assert.match(dir, /label: "the wall"/);
    assert.match(dir, /only fenn writes here/);
    const wallEntry = dir.slice(
      dir.indexOf('number: "08"'),
      dir.indexOf("];", dir.indexOf('number: "08"')),
    );
    assert.doesNotMatch(wallEntry, /reaction|twitter|x agent|leave a mark/i);
  });

  it("timestamps are absolute wall dates, not relative feed language", () => {
    const format = readFileSync(join(here, "format.ts"), "utf8");
    assert.match(format, /JUL 2026/);
    assert.doesNotMatch(format, /ago|relative|timeAgo/i);
  });
});
