import "server-only";

import type { FennAdminIdentity } from "@/lib/admin/auth";
import type { FennDeskIdentity } from "@/lib/desk/auth";
import type {
  DeskDeedDetail,
  DeskDeedEvidenceFilter,
  DeskDeedListItem,
  DeskDeedListPage,
  DeskDeedSort,
  DeskDeedStatusFilter,
} from "@/lib/desk/deeds-types";
import { formatDeedReward } from "@/lib/deeds/format";
import {
  approveDeedSubmission,
  rejectDeedSubmission,
  signSubmissionEvidenceImage,
  DeedModerationError,
} from "@/lib/deeds/moderation";
import { toSafeDeed } from "@/lib/deeds/rules";
import type {
  DeedRow,
  DeedSubmissionRow,
  DeedSubmissionStatus,
  SafeDeed,
} from "@/lib/deeds/types";
import { formatOutlawNumber } from "@/lib/profiles/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSubmissionId(id: string): string {
  const value = id.trim();
  if (!UUID_RE.test(value)) {
    throw new DeedModerationError("invalid_id", "Invalid submission id", 400);
  }
  return value;
}

const SUBMISSION_SELECT =
  "id, deed_id, profile_id, status, evidence_text, evidence_url, evidence_image_path, evidence_other, submitted_at, reviewed_at, review_note, leaf_awarded, leaf_ledger_id";

const DEED_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, external_reward_note, published_at";

export type DeskDeedListQuery = {
  status: DeskDeedStatusFilter;
  sort: DeskDeedSort;
  evidence: DeskDeedEvidenceFilter;
  greenwoodOnly: boolean;
  page: number;
  limit: number;
};

function deskActorAsAdmin(identity: FennDeskIdentity): FennAdminIdentity {
  return {
    profileId: identity.profileId,
    privyUserId: identity.privyUserId,
    walletAddress: identity.walletAddress,
    actorId: identity.actorId,
  };
}

function ageLabel(submittedAt: string, nowMs = Date.now()): string {
  const ms = nowMs - new Date(submittedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function evidenceTypes(row: DeedSubmissionRow): string[] {
  const types: string[] = [];
  if (row.evidence_text) types.push("text");
  if (row.evidence_url) types.push("url");
  if (row.evidence_image_path) types.push("image");
  if (row.evidence_other) types.push("other");
  return types;
}

function matchesEvidenceFilter(
  types: string[],
  filter: DeskDeedEvidenceFilter,
): boolean {
  if (filter === "all") return true;
  return types.includes(filter);
}

async function defaultAdmin() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

async function loadSigils(
  db: Awaited<ReturnType<typeof defaultAdmin>>,
  profileIds: string[],
): Promise<Map<string, { asciiBody: string; a11yLabel: string }>> {
  const map = new Map<string, { asciiBody: string; a11yLabel: string }>();
  if (profileIds.length === 0) return map;
  const { data } = await db
    .from("greenwood_sigil_assignments")
    .select(
      "profile_id, greenwood_sigil_catalogue ( ascii_body, a11y_label )",
    )
    .in("profile_id", profileIds);
  for (const row of data ?? []) {
    const r = row as {
      profile_id: string;
      greenwood_sigil_catalogue:
        | { ascii_body: string; a11y_label: string }
        | Array<{ ascii_body: string; a11y_label: string }>
        | null;
    };
    const cat = Array.isArray(r.greenwood_sigil_catalogue)
      ? r.greenwood_sigil_catalogue[0]
      : r.greenwood_sigil_catalogue;
    if (!cat) continue;
    map.set(r.profile_id, {
      asciiBody: cat.ascii_body,
      a11yLabel: cat.a11y_label,
    });
  }
  return map;
}

function toListItem(
  row: DeedSubmissionRow,
  deed: SafeDeed,
  profile: { outlaw_number: number; alias: string | null },
  sigil: { asciiBody: string; a11yLabel: string } | null,
): DeskDeedListItem {
  const types = evidenceTypes(row);
  const status = row.status as DeedSubmissionStatus;
  return {
    submissionId: row.id,
    deedId: deed.id,
    deedTitle: deed.title,
    deedSlug: deed.slug,
    profileId: row.profile_id,
    outlawLabel: `OUTLAW ${formatOutlawNumber(profile.outlaw_number)}`,
    displayName:
      profile.alias?.trim() ||
      `OUTLAW ${formatOutlawNumber(profile.outlaw_number)}`,
    sigil,
    submittedAt: row.submitted_at,
    status,
    reward: deed.reward,
    rewardLabel: formatDeedReward(deed.reward),
    accessScope: deed.accessScope,
    greenwoodOnly: deed.accessScope === "greenwood",
    isRepeatable: deed.isRepeatable,
    hasImageEvidence: Boolean(row.evidence_image_path),
    evidenceTypes: types,
    requiresEvidenceReview: types.length > 0 || status === "pending",
    ageLabel: ageLabel(row.submitted_at),
  };
}

export async function listDeskDeedSubmissions(
  query: DeskDeedListQuery,
): Promise<DeskDeedListPage> {
  const db = await defaultAdmin();
  const page = Math.max(1, query.page);
  const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const postFilter = query.evidence !== "all" || query.greenwoodOnly;

  let q = db
    .from("deed_submissions")
    .select(SUBMISSION_SELECT, { count: "exact" });
  if (query.status !== "all") {
    q = q.eq("status", query.status);
  }
  q = q.order("submitted_at", { ascending: query.sort !== "newest" });

  const { data, error, count } = await q.range(
    from,
    postFilter ? from + limit * 5 - 1 : to,
  );
  if (error) {
    throw new DeedModerationError("queue_failed", "Failed to load queue", 500);
  }

  const rows = (data ?? []) as DeedSubmissionRow[];
  if (rows.length === 0) {
    return { submissions: [], page, limit, total: count ?? 0, hasMore: false };
  }

  const deedIds = [...new Set(rows.map((r) => r.deed_id))];
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const [{ data: deeds }, { data: profiles }, sigils] = await Promise.all([
    db.from("deeds").select(DEED_SELECT).in("id", deedIds),
    db
      .from("profiles")
      .select("id, outlaw_number, alias")
      .in("id", profileIds),
    loadSigils(db, profileIds),
  ]);

  const deedMap = new Map(
    ((deeds ?? []) as DeedRow[]).map((d) => [d.id, toSafeDeed(d)]),
  );
  const profileMap = new Map(
    (
      (profiles ?? []) as Array<{
        id: string;
        outlaw_number: number;
        alias: string | null;
      }>
    ).map((p) => [p.id, p]),
  );

  let items = rows.flatMap((row) => {
    const deed = deedMap.get(row.deed_id);
    const profile = profileMap.get(row.profile_id);
    if (!deed || !profile) return [];
    const item = toListItem(
      row,
      deed,
      profile,
      sigils.get(row.profile_id) ?? null,
    );
    if (query.greenwoodOnly && !item.greenwoodOnly) return [];
    if (!matchesEvidenceFilter(item.evidenceTypes, query.evidence)) return [];
    return [item];
  });

  if (postFilter) items = items.slice(0, limit);

  return {
    submissions: items,
    page,
    limit,
    total: count ?? items.length,
    hasMore: (count ?? 0) > page * limit,
  };
}

export async function getDeskDeedSubmission(
  submissionId: string,
): Promise<DeskDeedDetail | null> {
  const id = assertSubmissionId(submissionId);
  const db = await defaultAdmin();
  const { data: subRow, error } = await db
    .from("deed_submissions")
    .select(SUBMISSION_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new DeedModerationError("read_failed", "Failed to load submission", 500);
  }
  if (!subRow) return null;
  const row = subRow as DeedSubmissionRow;

  const { data: deedRow } = await db
    .from("deeds")
    .select(DEED_SELECT)
    .eq("id", row.deed_id)
    .maybeSingle();
  if (!deedRow) return null;
  const deed = toSafeDeed(deedRow as DeedRow);

  const { data: profileRow } = await db
    .from("profiles")
    .select("id, outlaw_number, alias")
    .eq("id", row.profile_id)
    .maybeSingle();
  if (!profileRow) return null;

  const sigils = await loadSigils(db, [row.profile_id]);
  const listItem = toListItem(
    row,
    deed,
    profileRow as { outlaw_number: number; alias: string | null },
    sigils.get(row.profile_id) ?? null,
  );

  const rewardPreview =
    deed.reward.type === "fixed"
      ? {
          kind: "fixed" as const,
          fixedAmount: deed.reward.amount,
          min: null,
          max: null,
          expectedSource: "deed_approval" as const,
        }
      : deed.reward.type === "range"
        ? {
            kind: "range" as const,
            fixedAmount: null,
            min: deed.reward.min,
            max: deed.reward.max,
            expectedSource: "deed_approval" as const,
          }
        : {
            kind: "none" as const,
            fixedAmount: null,
            min: null,
            max: null,
            expectedSource: "deed_approval" as const,
          };

  return {
    ...listItem,
    deedDescription: deed.loreDescription,
    deedInstructions: deed.instructions,
    evidenceRequirements: deed.evidenceRequirements,
    evidenceText: row.evidence_text,
    evidenceUrl: row.evidence_url,
    evidenceOther: row.evidence_other,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    leafAwarded: row.leaf_awarded,
    startsAt: deed.startsAt,
    endsAt: deed.endsAt,
    rewardPreview,
  };
}

export async function deskApproveDeedSubmission(input: {
  submissionId: string;
  identity: FennDeskIdentity;
  leafAmount?: number | null;
  reviewNote?: string | null;
}) {
  return approveDeedSubmission({
    submissionId: input.submissionId,
    admin: deskActorAsAdmin(input.identity),
    leafAmount: input.leafAmount,
    reviewNote: input.reviewNote,
  });
}

export async function deskRejectDeedSubmission(input: {
  submissionId: string;
  identity: FennDeskIdentity;
  reviewNote: string;
}) {
  return rejectDeedSubmission({
    submissionId: input.submissionId,
    admin: deskActorAsAdmin(input.identity),
    reviewNote: input.reviewNote,
  });
}

export async function deskSignDeedEvidenceImage(submissionId: string) {
  return signSubmissionEvidenceImage(submissionId);
}

export { DeedModerationError };

export const DESK_DEED_DEFAULT_LIMIT = DEFAULT_LIMIT;
export const DESK_DEED_MAX_LIMIT = MAX_LIMIT;
