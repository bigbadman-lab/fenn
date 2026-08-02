import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  fireMessageBodyToParagraphs,
  GREENWOOD_FIRE_MESSAGE_FALLBACK,
  GREENWOOD_FIRE_MESSAGE_MAX_CHARS,
  paragraphsToFireMessageBody,
  validateFireMessageBodyInput,
} from "./fire-message";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("FENN SPEAKS fire message helpers", () => {
  it("splits stored body into plain-text paragraphs", () => {
    assert.deepEqual(
      fireMessageBodyToParagraphs(
        "The fire is small.\n\nIt has only just been lit.\nThose who arrive now will decide what it becomes.",
      ),
      [...GREENWOOD_FIRE_MESSAGE_FALLBACK],
    );
  });

  it("rejects empty and oversized bodies", () => {
    assert.deepEqual(validateFireMessageBodyInput("   \n  "), {
      ok: false,
      reason: "empty",
    });
    assert.deepEqual(
      validateFireMessageBodyInput(
        "x".repeat(GREENWOOD_FIRE_MESSAGE_MAX_CHARS + 1),
      ),
      { ok: false, reason: "too_long" },
    );
    assert.deepEqual(validateFireMessageBodyInput("  Keep the fire.  "), {
      ok: true,
      body: "Keep the fire.",
    });
  });

  it("fallback constant matches seed lines", () => {
    assert.equal(
      paragraphsToFireMessageBody(GREENWOOD_FIRE_MESSAGE_FALLBACK),
      "The fire is small.\nIt has only just been lit.\nThose who arrive now will decide what it becomes.",
    );
  });
});

describe("FENN SPEAKS migration and authority contracts", () => {
  it("migration seeds published message and enforces one published row", () => {
    const migration = read(
      "supabase/migrations/20260802120000_39_greenwood_fire_messages.sql",
    );
    assert.match(migration, /CREATE TABLE public\.greenwood_fire_messages/);
    assert.match(migration, /greenwood_fire_messages_one_published_uidx/);
    assert.match(migration, /The fire is small/);
    assert.match(migration, /status = 'published'/);
    assert.match(migration, /publish_greenwood_fire_message/);
    assert.match(migration, /FENN_FIRE_MESSAGE_NOT_DRAFT/);
    assert.match(migration, /already_published/);
    assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role/);
    assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
    assert.match(migration, /REVOKE ALL ON public\.greenwood_fire_messages FROM anon, authenticated/);
  });

  it("member page uses DB read with static fallback, not primary hardcoded constant", () => {
    const member = read("src/components/greenwood/greenwood-member.tsx");
    assert.match(member, /fetchGreenwoodSpeaks/);
    assert.match(member, /GREENWOOD_FIRE_MESSAGE_FALLBACK/);
    assert.doesNotMatch(member, /GREENWOOD_FIRE_MESSAGE\.map/);
  });

  it("Desk speaks routes require Desk access and reuse domain ops", () => {
    const list = read("src/app/api/desk/speaks/route.ts");
    const publish = read("src/app/api/desk/speaks/[id]/publish/route.ts");
    const archive = read("src/app/api/desk/speaks/[id]/archive/route.ts");
    assert.match(list, /requireFennDeskAccess/);
    assert.match(list, /createFireMessageDraft/);
    assert.match(publish, /requireFennDeskAccess/);
    assert.match(publish, /publishFireMessage/);
    assert.match(archive, /archiveFireMessageDraft/);
    assert.doesNotMatch(list, /requireFennAdmin/);
  });

  it("Admin speaks routes require Admin access and reuse the same ops", () => {
    const list = read("src/app/api/admin/greenwood/speaks/route.ts");
    const publish = read(
      "src/app/api/admin/greenwood/speaks/[id]/publish/route.ts",
    );
    assert.match(list, /requireFennAdmin/);
    assert.match(list, /createFireMessageDraft/);
    assert.match(publish, /requireFennAdmin/);
    assert.match(publish, /publishFireMessage/);
    assert.doesNotMatch(list, /requireFennDeskAccess/);
  });

  it("member speaks API requires Greenwood membership and returns display fields only", () => {
    const route = read("src/app/api/greenwood/speaks/route.ts");
    assert.match(route, /greenwood_entered_at/);
    assert.match(route, /getFireMessageForMemberDisplay/);
    assert.match(route, /private, no-store/);
    assert.doesNotMatch(route, /createFireMessageDraft|publishFireMessage/);
    assert.doesNotMatch(route, /created_by|published_by|status.*draft|recent/);
    assert.match(route, /paragraphs/);
    assert.match(route, /fromFallback/);
  });

  it("ops audit and forbid published body edits", () => {
    const ops = read("src/lib/greenwood/fire-messages/ops.ts");
    assert.match(ops, /writeAdminAuditLog/);
    assert.match(ops, /greenwood\.fire_message\.publish/);
    assert.match(ops, /greenwood\.fire_message\.create_draft/);
    assert.match(ops, /greenwood\.fire_message\.archive_draft/);
    assert.doesNotMatch(ops, /\.update\(\s*\{\s*body:/);
    assert.match(ops, /getFireMessageForMemberDisplay/);
    assert.match(ops, /fromFallback: true/);
  });

  it("member display helper selects published only", () => {
    const ops = read("src/lib/greenwood/fire-messages/ops.ts");
    assert.match(ops, /\.eq\("status", "published"\)/);
    assert.match(ops, /maybeSingle\(\)/);
    assert.doesNotMatch(ops, /status.*draft.*member|member.*draft/);
  });

  it("Desk nav includes FENN SPEAKS without THE GROVE", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /\/desk\/speaks/);
    assert.match(gate, /FENN SPEAKS/);
    const member = read("src/components/greenwood/greenwood-member.tsx");
    assert.doesNotMatch(member, /THE GROVE/);
    assert.match(member, /cache: "no-store"|fetchGreenwoodSpeaks/);
  });

  it("Desk publish uses confirmation and Admin page exists", () => {
    const panel = read("src/components/desk/desk-speaks-panel.tsx");
    assert.match(panel, /PUBLISH THIS MESSAGE/);
    assert.match(panel, /\[ archive draft \]/);
    assert.ok(
      read("src/app/admin/greenwood/speaks/page.tsx").includes("AdminSpeaksBoard"),
    );
  });

  it("does not create the forbidden bare fire_messages table", () => {
    const migration = read(
      "supabase/migrations/20260802120000_39_greenwood_fire_messages.sql",
    );
    assert.doesNotMatch(migration, /CREATE TABLE public\.fire_messages\b/);
    assert.match(migration, /CREATE TABLE public\.greenwood_fire_messages/);
  });
});
