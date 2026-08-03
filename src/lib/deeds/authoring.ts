import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import {
  DeedAuthoringError,
  DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS,
  assertDraftEditable,
  assertPublishAccessScope,
  assertStatusTransition,
  assertValidRewardForPublish,
  blankToNull,
  createDeedDraftSchema,
  generateDraftSlug,
  nonEmptyText,
  normalizeEvidenceRequirements,
  normalizeSlugCandidate,
  rewardToColumns,
  updateDeedDraftSchema,
  validateDateWindow,
  type CreateDeedDraftInput,
  type UpdateDeedDraftInput,
} from "@/lib/deeds/authoring-validation";
import { mapDbReward, toSafeDeed } from "@/lib/deeds/rules";
import type {
  DeedAccessScope,
  DeedEvidenceRequirements,
  DeedReward,
  DeedRow,
  SafeDeed,
} from "@/lib/deeds/types";

const DEED_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, eligibility, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, sponsor_contribution_id, external_reward_note, common_target_count, common_progress_count, published_at, created_at, updated_at";

export type DeskDeedDefinition = SafeDeed & {
  eligibility: unknown;
  sponsorContributionId: string | null;
  commonTargetCount: number | null;
  commonProgressCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DeedDefinitionFilter =
  | "all"
  | "draft"
  | "active"
  | "closed"
  | "archived";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    Boolean(error.message?.toLowerCase().includes("duplicate key")) ||
    Boolean(error.message?.includes("deeds_slug_uidx"))
  );
}

function toDefinition(row: DeedRow): DeskDeedDefinition {
  const safe = toSafeDeed(row);
  return {
    ...safe,
    eligibility: row.eligibility ?? {},
    sponsorContributionId: row.sponsor_contribution_id ?? null,
    commonTargetCount: row.common_target_count ?? null,
    commonProgressCount: row.common_progress_count ?? 0,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function loadDeedRow(
  db: SupabaseClient,
  deedId: string,
): Promise<DeedRow | null> {
  const { data, error } = await db
    .from("deeds")
    .select(DEED_SELECT)
    .eq("id", deedId)
    .maybeSingle();
  if (error) {
    throw new DeedAuthoringError("read_failed", "Failed to load deed", 500);
  }
  return (data as DeedRow | null) ?? null;
}

function mapRewardInput(
  reward: CreateDeedDraftInput["reward"] | undefined,
  fallback?: DeedReward,
): DeedReward {
  if (reward) return reward as DeedReward;
  return fallback ?? { type: "none" };
}

export async function createDeedDraft(
  input: CreateDeedDraftInput,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const parsed = createDeedDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new DeedAuthoringError("invalid_body", "Invalid deed draft payload", 422);
  }
  const body = parsed.data;
  const title = nonEmptyText(body.title, "title");
  const lore = blankToNull(body.loreDescription) ?? "";
  const instructions = blankToNull(body.instructions) ?? "";
  const reward = mapRewardInput(body.reward);
  const evidence = body.evidenceRequirements
    ? normalizeEvidenceRequirements(body.evidenceRequirements)
    : DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS;
  const window = validateDateWindow(body.startsAt, body.endsAt);
  const slug =
    normalizeSlugCandidate(body.slug) ?? generateDraftSlug(title);
  const columns = rewardToColumns(reward);

  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("deeds")
    .insert({
      title,
      lore_description: lore,
      instructions,
      category: blankToNull(body.category),
      slug,
      access_scope: body.accessScope ?? "road",
      status: "draft",
      ...columns,
      evidence_requirements: evidence,
      eligibility: {},
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      max_completions: body.maxCompletions ?? null,
      completions_count: 0,
      is_public: body.isPublic ?? true,
      is_repeatable: body.isRepeatable ?? false,
      sponsor_name: blankToNull(body.sponsorName),
      external_reward_note: blankToNull(body.externalRewardNote),
      common_progress_count: 0,
      published_at: null,
    })
    .select(DEED_SELECT)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DeedAuthoringError("slug_conflict", "Deed slug already exists", 409);
    }
    throw new DeedAuthoringError("write_failed", "Failed to create deed draft", 500);
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.create",
    entityType: "deed",
    entityId: row.id,
    afterState: {
      status: "draft",
      slug: row.slug,
      title: row.title,
      accessScope: row.access_scope,
    },
  });

  return toDefinition(row);
}

export async function updateDeedDraft(
  deedId: string,
  input: UpdateDeedDraftInput,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const parsed = updateDeedDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new DeedAuthoringError("invalid_body", "Invalid deed update payload", 422);
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new DeedAuthoringError("invalid_body", "No fields to update", 422);
  }

  const db = admin ?? (await defaultAdmin());
  const before = await loadDeedRow(db, deedId);
  if (!before) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }
  assertDraftEditable(before.status);

  const body = parsed.data;
  const patch: Record<string, unknown> = {};

  if (body.title !== undefined) {
    patch.title = nonEmptyText(body.title, "title");
  }
  if (body.loreDescription !== undefined) {
    patch.lore_description = blankToNull(body.loreDescription) ?? "";
  }
  if (body.instructions !== undefined) {
    patch.instructions = blankToNull(body.instructions) ?? "";
  }
  if (body.category !== undefined) {
    patch.category = blankToNull(body.category);
  }
  if (body.slug !== undefined) {
    const slug = normalizeSlugCandidate(body.slug);
    if (!slug) {
      throw new DeedAuthoringError("invalid_field", "slug is required when provided", 400);
    }
    patch.slug = slug;
  }
  if (body.accessScope !== undefined) {
    patch.access_scope = body.accessScope;
  }
  if (body.reward !== undefined) {
    Object.assign(patch, rewardToColumns(mapRewardInput(body.reward)));
  }
  if (body.evidenceRequirements !== undefined) {
    patch.evidence_requirements = normalizeEvidenceRequirements(
      body.evidenceRequirements,
    );
  }
  if (body.startsAt !== undefined || body.endsAt !== undefined) {
    const window = validateDateWindow(
      body.startsAt !== undefined ? body.startsAt : before.starts_at,
      body.endsAt !== undefined ? body.endsAt : before.ends_at,
    );
    patch.starts_at = window.startsAt;
    patch.ends_at = window.endsAt;
  }
  if (body.maxCompletions !== undefined) {
    patch.max_completions = body.maxCompletions;
  }
  if (body.isPublic !== undefined) {
    patch.is_public = body.isPublic;
  }
  if (body.isRepeatable !== undefined) {
    patch.is_repeatable = body.isRepeatable;
  }
  if (body.sponsorName !== undefined) {
    patch.sponsor_name = blankToNull(body.sponsorName);
  }
  if (body.externalRewardNote !== undefined) {
    patch.external_reward_note = blankToNull(body.externalRewardNote);
  }

  const { data, error } = await db
    .from("deeds")
    .update(patch)
    .eq("id", deedId)
    .eq("status", "draft")
    .select(DEED_SELECT)
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DeedAuthoringError("slug_conflict", "Deed slug already exists", 409);
    }
    throw new DeedAuthoringError("write_failed", "Failed to update deed draft", 500);
  }
  if (!data) {
    throw new DeedAuthoringError("not_editable", "Only draft Deeds can be edited", 409);
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.update",
    entityType: "deed",
    entityId: row.id,
    beforeState: {
      status: before.status,
      slug: before.slug,
      title: before.title,
    },
    afterState: {
      status: row.status,
      slug: row.slug,
      title: row.title,
      accessScope: row.access_scope,
    },
  });

  return toDefinition(row);
}

export async function publishDeed(
  deedId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const db = admin ?? (await defaultAdmin());
  const before = await loadDeedRow(db, deedId);
  if (!before) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }
  if (before.status !== "draft") {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only draft Deeds can be published",
      409,
    );
  }
  assertStatusTransition("draft", "active");

  const title = nonEmptyText(before.title, "title");
  const lore = nonEmptyText(before.lore_description, "loreDescription");
  const instructions = nonEmptyText(before.instructions, "instructions");
  const slug = normalizeSlugCandidate(before.slug);
  if (!slug) {
    throw new DeedAuthoringError(
      "invalid_field",
      "slug is required to publish",
      400,
    );
  }
  const scope = before.access_scope as DeedAccessScope;
  assertPublishAccessScope(scope);

  const rewardMapped = mapDbReward(before);
  if (!rewardMapped.ok) {
    throw new DeedAuthoringError("invalid_reward", rewardMapped.error, 400);
  }
  assertValidRewardForPublish(rewardMapped.reward);

  const evidence = normalizeEvidenceRequirements(before.evidence_requirements, {
    forPublish: true,
  });
  validateDateWindow(before.starts_at, before.ends_at);

  if (
    before.max_completions != null &&
    (!Number.isInteger(before.max_completions) || before.max_completions <= 0)
  ) {
    throw new DeedAuthoringError(
      "invalid_field",
      "maxCompletions must be null or a positive integer",
      400,
    );
  }

  const publishedAt = before.published_at ?? new Date().toISOString();

  const { data, error } = await db
    .from("deeds")
    .update({
      title,
      lore_description: lore,
      instructions,
      slug,
      evidence_requirements: evidence,
      status: "active",
      published_at: publishedAt,
      ...rewardToColumns(rewardMapped.reward),
    })
    .eq("id", deedId)
    .eq("status", "draft")
    .select(DEED_SELECT)
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DeedAuthoringError("slug_conflict", "Deed slug already exists", 409);
    }
    throw new DeedAuthoringError("write_failed", "Failed to publish deed", 500);
  }
  if (!data) {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only draft Deeds can be published",
      409,
    );
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.publish",
    entityType: "deed",
    entityId: row.id,
    beforeState: { status: "draft", slug: before.slug },
    afterState: {
      status: "active",
      slug: row.slug,
      publishedAt: row.published_at,
    },
  });

  return toDefinition(row);
}

export async function closeDeed(
  deedId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const db = admin ?? (await defaultAdmin());
  const before = await loadDeedRow(db, deedId);
  if (!before) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }
  if (before.status !== "active") {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only active Deeds can be closed",
      409,
    );
  }

  const { data, error } = await db
    .from("deeds")
    .update({ status: "closed" })
    .eq("id", deedId)
    .eq("status", "active")
    .select(DEED_SELECT)
    .maybeSingle();

  if (error) {
    throw new DeedAuthoringError("write_failed", "Failed to close deed", 500);
  }
  if (!data) {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only active Deeds can be closed",
      409,
    );
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.close",
    entityType: "deed",
    entityId: row.id,
    beforeState: { status: "active" },
    afterState: { status: "closed" },
  });

  return toDefinition(row);
}

export async function archiveDeed(
  deedId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const db = admin ?? (await defaultAdmin());
  const before = await loadDeedRow(db, deedId);
  if (!before) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }
  if (before.status !== "closed") {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only closed Deeds can be archived",
      409,
    );
  }

  const { data, error } = await db
    .from("deeds")
    .update({ status: "archived" })
    .eq("id", deedId)
    .eq("status", "closed")
    .select(DEED_SELECT)
    .maybeSingle();

  if (error) {
    throw new DeedAuthoringError("write_failed", "Failed to archive deed", 500);
  }
  if (!data) {
    throw new DeedAuthoringError(
      "invalid_transition",
      "Only closed Deeds can be archived",
      409,
    );
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.archive",
    entityType: "deed",
    entityId: row.id,
    beforeState: { status: "closed" },
    afterState: { status: "archived" },
  });

  return toDefinition(row);
}

export async function deleteDeedDraft(
  deedId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<{ deleted: true; deedId: string }> {
  const db = admin ?? (await defaultAdmin());
  const before = await loadDeedRow(db, deedId);
  if (!before) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }
  if (before.status !== "draft") {
    throw new DeedAuthoringError(
      "not_deletable",
      "Only draft Deeds without submissions can be deleted",
      409,
    );
  }

  const { count, error: countError } = await db
    .from("deed_submissions")
    .select("id", { count: "exact", head: true })
    .eq("deed_id", deedId);
  if (countError) {
    throw new DeedAuthoringError("read_failed", "Failed to check submissions", 500);
  }
  if ((count ?? 0) > 0) {
    throw new DeedAuthoringError(
      "has_submissions",
      "Cannot delete a Deed that has submissions",
      409,
    );
  }

  const { error } = await db
    .from("deeds")
    .delete()
    .eq("id", deedId)
    .eq("status", "draft");
  if (error) {
    throw new DeedAuthoringError("write_failed", "Failed to delete deed draft", 500);
  }

  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.delete",
    entityType: "deed",
    entityId: deedId,
    beforeState: {
      status: "draft",
      slug: before.slug,
      title: before.title,
    },
    afterState: { deleted: true },
  });

  return { deleted: true, deedId };
}

export async function duplicateDeed(
  deedId: string,
  actorId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition> {
  const db = admin ?? (await defaultAdmin());
  const source = await loadDeedRow(db, deedId);
  if (!source) {
    throw new DeedAuthoringError("not_found", "Deed not found", 404);
  }

  const titleBase = source.title.trim() || "Deed";
  const title = titleBase.endsWith("(Copy)")
    ? titleBase
    : `${titleBase} (Copy)`.slice(0, 200);
  const rewardMapped = mapDbReward(source);
  const reward = rewardMapped.ok ? rewardMapped.reward : ({ type: "none" } as DeedReward);
  let evidence: DeedEvidenceRequirements = DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS;
  try {
    evidence = normalizeEvidenceRequirements(source.evidence_requirements);
  } catch {
    evidence = DEFAULT_DRAFT_EVIDENCE_REQUIREMENTS;
  }

  const slug = generateDraftSlug(title);
  const columns = rewardToColumns(reward);
  // Common is not authorable for release; never carry an unpublishable scope into a new draft.
  const accessScope: DeedAccessScope =
    source.access_scope === "greenwood" ? "greenwood" : "road";

  const { data, error } = await db
    .from("deeds")
    .insert({
      title,
      lore_description: source.lore_description,
      instructions: source.instructions,
      category: source.category,
      slug,
      access_scope: accessScope,
      status: "draft",
      ...columns,
      evidence_requirements: evidence,
      eligibility: {},
      starts_at: null,
      ends_at: null,
      max_completions: source.max_completions,
      completions_count: 0,
      is_public: source.is_public,
      is_repeatable: source.is_repeatable,
      sponsor_name: source.sponsor_name,
      external_reward_note: source.external_reward_note,
      common_target_count: null,
      common_progress_count: 0,
      published_at: null,
      // Submissions / Wall links are never copied — new draft is definition-only.
    })
    .select(DEED_SELECT)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DeedAuthoringError("slug_conflict", "Deed slug already exists", 409);
    }
    throw new DeedAuthoringError("write_failed", "Failed to duplicate deed", 500);
  }

  const row = data as DeedRow;
  await writeAdminAuditLog(db, {
    actorId,
    action: "deed.definition.duplicate",
    entityType: "deed",
    entityId: row.id,
    beforeState: { sourceDeedId: source.id, sourceStatus: source.status },
    afterState: { status: "draft", slug: row.slug, title: row.title },
  });

  return toDefinition(row);
}

export async function listDeedDefinitions(
  filter: DeedDefinitionFilter = "all",
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition[]> {
  const db = admin ?? (await defaultAdmin());
  let query = db
    .from("deeds")
    .select(DEED_SELECT)
    .order("updated_at", { ascending: false });
  if (filter !== "all") {
    query = query.eq("status", filter);
  }
  const { data, error } = await query;
  if (error) {
    throw new DeedAuthoringError("read_failed", "Failed to list deeds", 500);
  }
  return ((data ?? []) as DeedRow[]).map(toDefinition);
}

export async function getDeedDefinition(
  deedId: string,
  admin?: SupabaseClient,
): Promise<DeskDeedDefinition | null> {
  const db = admin ?? (await defaultAdmin());
  const row = await loadDeedRow(db, deedId);
  return row ? toDefinition(row) : null;
}

export { DeedAuthoringError };
