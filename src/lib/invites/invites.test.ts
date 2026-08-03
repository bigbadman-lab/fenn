import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INVITE_CODE_ALPHABET,
  isUrlSafeInviteCode,
  isValidInviteCodeFormat,
  normalizeInviteCode,
} from "@/lib/invites/codes";
import {
  INVITE_COOKIE_NAME,
  INVITE_MAX_LEAF,
  INVITE_REWARD_CAP,
  INVITE_REWARD_PER,
} from "@/lib/invites/constants";
import { buildOutlawInviteUrl } from "@/lib/invites/urls";
import { leafIdempotencyKeys } from "@/lib/leaf/validate";
import { isKnownLeafSourceType, toLedgerPublicCategory } from "@/lib/ledger/normalize";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Outlaw Invite — codes", () => {
  it("accepts URL-safe alphanumeric codes of 8–32 chars", () => {
    assert.equal(isValidInviteCodeFormat("AbCdEfGh12"), true);
    assert.equal(isUrlSafeInviteCode("AbCdEfGh12"), true);
    assert.equal(normalizeInviteCode("  AbCdEfGh12  "), "AbCdEfGh12");
  });

  it("rejects short, long, and unsafe codes", () => {
    assert.equal(isValidInviteCodeFormat("short"), false);
    assert.equal(isValidInviteCodeFormat("a".repeat(33)), false);
    assert.equal(isValidInviteCodeFormat("bad code!"), false);
    assert.equal(normalizeInviteCode("not-valid"), null);
    assert.equal(normalizeInviteCode(null), null);
  });

  it("alphabet avoids ambiguous 0/O/1/l/I and matches SQL generator charset", () => {
    assert.doesNotMatch(INVITE_CODE_ALPHABET, /[01OIl]/);
    const sql = read("supabase/migrations/20260803130000_42_outlaw_invite.sql");
    assert.match(sql, /ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789/);
  });
});

describe("Outlaw Invite — constants and URL", () => {
  it("uses 5 LEAF per invite and 10 rewarded cap (50 max)", () => {
    assert.equal(INVITE_REWARD_PER, 5);
    assert.equal(INVITE_REWARD_CAP, 10);
    assert.equal(INVITE_MAX_LEAF, 50);
  });

  it("canonical cookie name is fenn_invite", () => {
    assert.equal(INVITE_COOKIE_NAME, "fenn_invite");
  });

  it("builds environment invite URL as /enter?invite=", () => {
    const url = buildOutlawInviteUrl("AbCdEfGh12xx", "https://imfenn.com");
    assert.equal(url, "https://imfenn.com/enter?invite=AbCdEfGh12xx");
    assert.equal(
      buildOutlawInviteUrl("AbCdEfGh12xx", "https://imfenn.com/"),
      "https://imfenn.com/enter?invite=AbCdEfGh12xx",
    );
  });
});

describe("Outlaw Invite — LEAF contracts", () => {
  it("idempotency key is stable on invited profile", () => {
    assert.equal(
      leafIdempotencyKeys.outlawInviteReward(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ),
      "outlaw_invite:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:reward",
    );
  });

  it("invite is a known ledger source mapped to SYSTEM", () => {
    assert.equal(isKnownLeafSourceType("invite"), true);
    assert.equal(toLedgerPublicCategory("invite"), "SYSTEM");
  });
});

describe("Outlaw Invite — migration integrity", () => {
  const migration = read(
    "supabase/migrations/20260803130000_42_outlaw_invite.sql",
  );
  const verify = read("supabase/verify_outlaw_invite.sql");

  it("adds invite_code with backfill and uniqueness", () => {
    assert.match(migration, /profiles\.invite_code|ADD COLUMN IF NOT EXISTS invite_code/);
    assert.match(migration, /profiles_invite_code_uidx/);
    assert.match(migration, /generate_outlaw_invite_code/);
    assert.match(migration, /profiles_set_invite_code/);
    assert.match(migration, /invite_code cannot be changed|INVITE_CODE_IMMUTABLE/);
  });

  it("creates outlaw_invites with one-invited uniqueness and self-invite check", () => {
    assert.match(migration, /CREATE TABLE public\.outlaw_invites/);
    assert.match(migration, /outlaw_invites_invited_profile_uidx/);
    assert.match(migration, /inviter_profile_id <> invited_profile_id/);
    assert.match(migration, /reward_amount IN \(0, 5\)/);
    assert.match(migration, /status IN \('registered', 'rewarded', 'cap_reached', 'rejected'\)/);
  });

  it("extends leaf_ledger source_type with invite only once", () => {
    assert.match(migration, /'invite'/);
    assert.match(migration, /'onboarding',\s*'invite'/);
    assert.match(migration, /leaf_ledger_source_type_check/);
  });

  it("atomic RPC enforces cap, lock, ledger key and service_role only", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.register_outlaw_invite/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /outlaw_invite:' \|\| p_invited_profile_id::text \|\| ':reward'/);
    assert.match(migration, /v_rewarded_count >= c_cap/);
    assert.match(migration, /c_reward integer := 5/);
    assert.match(migration, /c_cap integer := 10/);
    assert.match(migration, /source_type,\s*[\s\S]*'invite'/);
    assert.match(migration, /actor_id,\s*[\s\S]*'outlaw_invite'/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.register_outlaw_invite/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.register_outlaw_invite\(text, uuid\) TO service_role/);
    assert.doesNotMatch(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.register_outlaw_invite\(text, uuid\) TO anon/,
    );
  });

  it("closes First Thirty for inviter when lifetime threshold met after reward", () => {
    assert.match(migration, /first_thirty_close_if_needed/);
    assert.match(migration, /first_thirty_lifetime_leaf/);
  });

  it("RLS enabled and retries table present", () => {
    assert.match(migration, /CREATE TABLE public\.outlaw_invite_retries/);
    assert.match(migration, /ALTER TABLE public\.outlaw_invites ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.outlaw_invites FROM anon/);
  });

  it("has verification SQL for cap, uniqueness and grants", () => {
    assert.match(verify, /profiles_invite_code_uidx/);
    assert.match(verify, /register_outlaw_invite/);
    assert.match(verify, /leaf_ledger_source_type_check/);
    assert.match(verify, /greenwood\.lifetime_leaf_threshold/);
  });
});

describe("Outlaw Invite — application integration", () => {
  it("registers invite after genuine profile creation only", () => {
    const reg = read("src/lib/profiles/register.ts");
    assert.match(reg, /tryConsumeInviteAfterRegistration/);
    assert.match(reg, /if \(created\)/);
    assert.match(reg, /clearInviteCookie/);
  });

  it("auth/me retries only durable retry rows and clears bare cookies for members", () => {
    const me = read("src/app/api/auth/me/route.ts");
    assert.match(me, /processInviteRetryForProfile/);
    assert.match(me, /clearInviteCookie/);
  });

  it("public capture and auth me APIs exist", () => {
    const capture = read("src/app/api/invites/capture/route.ts");
    const member = read("src/app/api/invites/me/route.ts");
    assert.match(capture, /export async function POST/);
    assert.match(capture, /valid: false/);
    assert.doesNotMatch(capture, /profileId|wallet_address|privy/i);
    assert.match(member, /getOutlawInviteMemberSummary/);
    assert.match(member, /no-store/);
    assert.match(member, /not_registered/);
  });

  it("enter route captures invite and continues to registration", () => {
    const enter = read("src/app/enter/page.tsx");
    assert.match(enter, /captureInviteAttribution/);
    assert.match(enter, /setInviteCookie/);
    assert.match(enter, /\/outlaw\/register/);
    assert.match(enter, /#outlaw-register/);
  });

  it("/outlaw surface includes invite section after First Thirty", () => {
    const page = read("src/app/outlaw/page.tsx");
    const ui = read("src/components/outlaw/outlaw-invite.tsx");
    assert.match(page, /OutlawFirstThirty/);
    assert.match(page, /OutlawInvite/);
    assert.ok(
      page.indexOf("OutlawFirstThirty") < page.indexOf("OutlawInvite"),
    );
    assert.ok(page.indexOf("OutlawInvite") < page.indexOf("OutlawWallet"));
    assert.ok(page.indexOf("OutlawWallet") < page.indexOf("outlaw-page__account"));
    assert.match(ui, /INVITE AN OUTLAW/);
    assert.match(ui, /5 LEAF FOR EACH OUTLAW WHO ARRIVES/);
    assert.match(ui, /UP TO 10 REWARDED INVITES/);
    assert.match(ui, /the road has been copied\./);
    assert.match(ui, /the road could not be copied\./);
    assert.match(ui, /aria-live="polite"/);
    assert.match(ui, /OUTLAWS YOU BROUGHT TO THE ROAD/);
    assert.match(ui, /No more LEAF will be carried back/);
    assert.match(ui, /useOutlawInviteSummary/);
    assert.match(ui, /the road cannot be copied just now/);
    assert.doesNotMatch(ui, /referral|affiliate|commission|conversion/i);
  });

  it("landing copy is restrained and does not expose private fields", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /AN OUTLAW LED YOU HERE/);
    assert.match(panel, /The road is still yours to walk/);
    assert.match(panel, /Complete the Register and your arrival will be remembered/);
    // Landing notice does not surface private inviter identity fields
    const landing = panel.slice(
      panel.indexOf("function InviteLedNotice"),
      panel.indexOf("type OutlawRegisterPanelProps"),
    );
    assert.doesNotMatch(landing, /walletAddress|privyUserId|email/i);
    assert.doesNotMatch(landing, /profile\.id|profileId/);
  });

  it("Desk shows read-only invite summary with no mutation controls", () => {
    const types = read("src/lib/desk/register-types.ts");
    const panel = read("src/components/desk/desk-register-member-panel.tsx");
    const reg = read("src/lib/desk/register.ts");
    assert.match(types, /DeskRegisterInviteSummary/);
    assert.match(reg, /getDeskInviteSummary/);
    assert.match(panel, /INVITES/);
    assert.match(panel, /Remaining cap/);
    assert.doesNotMatch(panel, /approve invite|reject invite|reset cap|force attach/i);
  });

  it("cookie helpers require HttpOnly SameSite Lax", () => {
    const cookie = read("src/lib/invites/cookie.ts");
    assert.match(cookie, /httpOnly:\s*true/);
    assert.match(cookie, /sameSite:\s*"lax"/);
    assert.match(cookie, /secure:\s*isProduction\(\)/);
  });

  it("CSS supports mobile wrap and forced-colours", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.outlaw-invite/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /forced-colors:\s*active/);
    assert.match(css, /CanvasText/);
  });

  it("member summary and recent arrivals expose only safe fields", () => {
    const summary = read("src/lib/invites/member-summary.ts");
    const types = read("src/lib/invites/types.ts");
    assert.match(types, /outlawLabel/);
    assert.match(types, /arrivedAt/);
    assert.match(types, /rewarded/);
    // Public DTOs use only safe arrival fields
    assert.match(types, /OutlawInviteRecentArrival/);
    assert.doesNotMatch(types, /\bwalletAddress\b/);
    assert.doesNotMatch(types, /\bprivyUserId\b/);
    assert.doesNotMatch(types, /\bprofileId\b/);
    assert.doesNotMatch(
      summary,
      /why_statement|privy_user|x_handle|chosen_name/,
    );
    assert.match(summary, /outlaw_number/);
  });
});

describe("Outlaw Invite — reward math documentation", () => {
  it("ten rewards max 50 LEAF; eleventh is zero reward still recorded", () => {
    const migration = read(
      "supabase/migrations/20260803130000_42_outlaw_invite.sql",
    );
    assert.match(migration, /status,\s*[\s\S]*'cap_reached'/);
    assert.match(migration, /reward_amount,\s*[\s\S]*0,/);
    assert.equal(INVITE_REWARD_PER * INVITE_REWARD_CAP, 50);
  });
});
