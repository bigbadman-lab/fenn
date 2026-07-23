import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FENN_CANON_KEY_PATTERN,
  getFennCanonDocument,
  listFennCanonDocuments,
  listFennCanonKeys,
} from "@/content/canon";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

const REQUIRED_KEYS = [
  "fenn.identity",
  "fenn.outlaw",
  "fenn.leaf",
  "fenn.deeds",
  "fenn.camp",
  "fenn.memory",
  "fenn.greenwood",
  "fenn.economy.circulation",
  "fenn.wall",
  "fenn.knowledge",
  "fenn.philosophy.crown",
  "fenn.philosophy.road",
] as const;

describe("Fenn Canon corpus", () => {
  it("has unique stable keys and non-empty titles/content", () => {
    const docs = listFennCanonDocuments();
    assert.ok(docs.length >= 10);
    const keys = docs.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const doc of docs) {
      assert.match(doc.key, FENN_CANON_KEY_PATTERN);
      assert.ok(doc.title.trim().length > 0);
      assert.ok(doc.content.trim().length > 0);
      assert.equal(doc.visibility, "public");
    }
    assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("covers major world concepts", () => {
    const keys = new Set(listFennCanonKeys());
    for (const key of REQUIRED_KEYS) {
      assert.ok(keys.has(key), `missing ${key}`);
    }
  });

  it("states memory and Wall principles", () => {
    const memory = getFennCanonDocument("fenn.memory");
    assert.ok(memory);
    assert.match(
      memory.content,
      /A conversation is not automatically FENN memory/,
    );

    const wall = getFennCanonDocument("fenn.wall");
    assert.ok(wall);
    assert.match(wall.content, /FENN speaks/);
    assert.match(wall.content, /Everyone else witnesses/);
  });

  it("preserves Treasury/Commons/Circulation/Ledger distinction without live amounts", () => {
    const econ = getFennCanonDocument("fenn.economy.circulation");
    assert.ok(econ);
    assert.match(econ.content, /TREASURY/);
    assert.match(econ.content, /COMMONS/);
    assert.match(econ.content, /CIRCULATION/);
    assert.match(econ.content, /LEDGER/);
    assert.match(econ.content, /what FENN holds/);
    assert.match(econ.content, /what FENN has committed/);
    assert.match(econ.content, /what actually moved/);
    assert.match(econ.content, /permanent record of movement/);
    assert.doesNotMatch(econ.content, /\$5,000|2,400,000|members\s+184/i);
  });

  it("avoids mutable live-state and private internals", () => {
    const blob = listFennCanonDocuments()
      .map((d) => `${d.title}\n${d.content}`)
      .join("\n");
    assert.doesNotMatch(blob, /SUPABASE_SERVICE_ROLE|OPENAI_API_KEY|FENN_ADMIN/);
    assert.doesNotMatch(blob, /service-role|requireFennAdmin|\/api\//i);
    assert.doesNotMatch(blob, /memory_candidate_flag|spamProbability|rewardRecommendation/);
    assert.doesNotMatch(blob, /current balance is|balance:\s*\d+/i);
    assert.doesNotMatch(blob, /0x[a-fA-F0-9]{40}/);
  });

  it("is plain text without HTML markup", () => {
    for (const doc of listFennCanonDocuments()) {
      assert.doesNotMatch(doc.content, /<\/?[a-z][^>]*>/i);
      assert.doesNotMatch(doc.content, /dangerouslySetInnerHTML/);
    }
  });
});

describe("Stage 11.2 Canon source safety", () => {
  it("has no public Canon API route", () => {
    assert.equal(existsSync(join(repo, "src/app/api/canon")), false);
    assert.equal(existsSync(join(repo, "src/app/api/canon/route.ts")), false);
  });

  it("sync module is server-only and ops script is explicit", () => {
    const sync = readFileSync(join(here, "sync.ts"), "utf8");
    assert.match(sync, /server-only/);
    assert.match(sync, /CANON_SYNC_ACTOR_ID/);
    assert.doesNotMatch(sync, /embeddings|retrieveFennKnowledge|openai/i);

    const script = readFileSync(
      join(repo, "scripts/sync-fenn-canon.ts"),
      "utf8",
    );
    assert.match(script, /syncFennCanon/);
  });
});
