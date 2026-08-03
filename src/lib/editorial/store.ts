import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EDITORIAL_CATEGORY_LABELS,
  type EditorialCategory,
  type EditorialConfidence,
  type EditorialApprovalState,
} from "@/lib/editorial/categories";
import { EditorialError } from "@/lib/editorial/errors";
import type {
  EditorialBrief,
  EditorialDailyOverview,
  EditorialDraftTransmission,
  EditorialRobinhoodContext,
  SafeEditorialRun,
  SafeEditorialTransmission,
} from "@/lib/editorial/types";
import {
  EDITORIAL_GENERATOR_VERSION,
  EDITORIAL_PROMPT_VERSION,
} from "@/lib/editorial/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

type RunRow = {
  id: string;
  covered_date: string;
  status: string;
  world_summary: EditorialDailyOverview;
  robinhood_summary: EditorialRobinhoodContext;
  editorial_brief: EditorialBrief;
  prompt_version: string;
  generator_version: string;
  created_by: string;
  created_at: string;
};

type TransmissionRow = {
  id: string;
  run_id: string;
  slot_index: number;
  category: string;
  title: string;
  body: string;
  edited_body: string | null;
  operator_rationale: string;
  source_signals: unknown;
  confidence: string;
  approval_state: string;
  copy_count: number;
  updated_at: string;
};

function asSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toSafeTransmission(row: TransmissionRow): SafeEditorialTransmission {
  const category = row.category as EditorialCategory;
  const effective = (row.edited_body ?? row.body).trim();
  return {
    id: row.id,
    runId: row.run_id,
    slotIndex: row.slot_index,
    category,
    categoryLabel: EDITORIAL_CATEGORY_LABELS[category] ?? row.category,
    title: row.title,
    body: effective,
    originalBody: row.body,
    editedBody: row.edited_body,
    operatorRationale: row.operator_rationale,
    sourceSignals: asSignals(row.source_signals),
    confidence: row.confidence as EditorialConfidence,
    approvalState: row.approval_state as EditorialApprovalState,
    copyCount: row.copy_count,
    updatedAt: row.updated_at,
  };
}

function toSafeRun(
  run: RunRow,
  transmissions: TransmissionRow[],
): SafeEditorialRun {
  const ordered = [...transmissions].sort((a, b) => a.slot_index - b.slot_index);
  const safe = ordered.map(toSafeTransmission);
  return {
    id: run.id,
    coveredDate: run.covered_date,
    status: run.status === "archived" ? "archived" : "ready",
    worldSummary: run.world_summary,
    editorialBrief: run.editorial_brief,
    promptVersion: run.prompt_version,
    generatorVersion: run.generator_version,
    createdBy: run.created_by,
    createdAt: run.created_at,
    transmissions: safe,
    approvedCount: safe.filter((t) => t.approvalState === "approved").length,
    draftCount: safe.filter((t) => t.approvalState === "draft").length,
  };
}

export async function findLatestEditorialRunForDate(
  coveredDate: string,
  options?: { admin?: SupabaseClient },
): Promise<SafeEditorialRun | null> {
  const admin = options?.admin ?? (await defaultAdmin());
  const { data: run, error } = await admin
    .from("editorial_runs")
    .select("*")
    .eq("covered_date", coveredDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new EditorialError(
      "editorial_unavailable",
      `editorial_runs: ${error.message}`,
      503,
    );
  }
  if (!run) return null;

  const { data: txs, error: txError } = await admin
    .from("editorial_transmissions")
    .select("*")
    .eq("run_id", run.id)
    .order("slot_index", { ascending: true });
  if (txError) {
    throw new EditorialError(
      "editorial_unavailable",
      `editorial_transmissions: ${txError.message}`,
      503,
    );
  }
  return toSafeRun(run as RunRow, (txs ?? []) as TransmissionRow[]);
}

export async function getEditorialRunById(
  runId: string,
  options?: { admin?: SupabaseClient },
): Promise<SafeEditorialRun> {
  const admin = options?.admin ?? (await defaultAdmin());
  const { data: run, error } = await admin
    .from("editorial_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    throw new EditorialError(
      "editorial_unavailable",
      `editorial_runs: ${error.message}`,
      503,
    );
  }
  if (!run) {
    throw new EditorialError(
      "editorial_not_found",
      "Editorial run not found",
      404,
    );
  }
  const { data: txs, error: txError } = await admin
    .from("editorial_transmissions")
    .select("*")
    .eq("run_id", run.id)
    .order("slot_index", { ascending: true });
  if (txError) {
    throw new EditorialError(
      "editorial_unavailable",
      `editorial_transmissions: ${txError.message}`,
      503,
    );
  }
  return toSafeRun(run as RunRow, (txs ?? []) as TransmissionRow[]);
}

export async function getEditorialTransmissionById(
  transmissionId: string,
  options?: { admin?: SupabaseClient },
): Promise<{ run: SafeEditorialRun; transmission: SafeEditorialTransmission }> {
  const admin = options?.admin ?? (await defaultAdmin());
  const { data: row, error } = await admin
    .from("editorial_transmissions")
    .select("*")
    .eq("id", transmissionId)
    .maybeSingle();
  if (error) {
    throw new EditorialError(
      "editorial_unavailable",
      error.message,
      503,
    );
  }
  if (!row) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  const run = await getEditorialRunById(row.run_id, { admin });
  const transmission = run.transmissions.find((t) => t.id === transmissionId);
  if (!transmission) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  return { run, transmission };
}

export async function persistEditorialRun(input: {
  coveredDate: string;
  createdBy: string;
  worldSummary: EditorialDailyOverview;
  robinhoodSummary: EditorialRobinhoodContext;
  editorialBrief: EditorialBrief;
  transmissions: EditorialDraftTransmission[];
  admin?: SupabaseClient;
}): Promise<SafeEditorialRun> {
  const admin = input.admin ?? (await defaultAdmin());

  const { data: run, error } = await admin
    .from("editorial_runs")
    .insert({
      covered_date: input.coveredDate,
      status: "ready",
      world_summary: input.worldSummary,
      robinhood_summary: input.robinhoodSummary,
      editorial_brief: input.editorialBrief,
      prompt_version: EDITORIAL_PROMPT_VERSION,
      generator_version: EDITORIAL_GENERATOR_VERSION,
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (error || !run) {
    throw new EditorialError(
      "editorial_unavailable",
      `Failed to store editorial run: ${error?.message ?? "unknown"}`,
      503,
    );
  }

  const rows = input.transmissions.map((t, index) => ({
    run_id: run.id,
    slot_index: index,
    category: t.category,
    title: t.title,
    body: t.body,
    edited_body: null,
    operator_rationale: t.operatorRationale,
    source_signals: t.sourceSignals,
    confidence: t.confidence,
    approval_state: "draft",
    copy_count: 0,
  }));

  const { data: txs, error: txError } = await admin
    .from("editorial_transmissions")
    .insert(rows)
    .select("*");

  if (txError || !txs) {
    // Best-effort cleanup
    await admin.from("editorial_runs").delete().eq("id", run.id);
    throw new EditorialError(
      "editorial_unavailable",
      `Failed to store transmissions: ${txError?.message ?? "unknown"}`,
      503,
    );
  }

  return toSafeRun(run as RunRow, txs as TransmissionRow[]);
}

export async function updateTransmissionEditedBody(input: {
  transmissionId: string;
  editedBody: string;
  admin?: SupabaseClient;
}): Promise<SafeEditorialTransmission> {
  const admin = input.admin ?? (await defaultAdmin());
  const body = input.editedBody.trim();
  if (!body) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Edited body cannot be empty",
      400,
    );
  }
  const { data, error } = await admin
    .from("editorial_transmissions")
    .update({ edited_body: body })
    .eq("id", input.transmissionId)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new EditorialError("editorial_unavailable", error.message, 503);
  }
  if (!data) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  return toSafeTransmission(data as TransmissionRow);
}

export async function replaceTransmissionDraft(input: {
  transmissionId: string;
  draft: EditorialDraftTransmission;
  admin?: SupabaseClient;
}): Promise<SafeEditorialTransmission> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data: existing, error: findError } = await admin
    .from("editorial_transmissions")
    .select("*")
    .eq("id", input.transmissionId)
    .maybeSingle();
  if (findError) {
    throw new EditorialError("editorial_unavailable", findError.message, 503);
  }
  if (!existing) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  if (existing.category !== input.draft.category) {
    throw new EditorialError(
      "editorial_invalid_input",
      "Category cannot change on regenerate",
      400,
    );
  }

  const { data, error } = await admin
    .from("editorial_transmissions")
    .update({
      title: input.draft.title,
      body: input.draft.body,
      edited_body: null,
      operator_rationale: input.draft.operatorRationale,
      source_signals: input.draft.sourceSignals,
      confidence: input.draft.confidence,
      approval_state: "draft",
    })
    .eq("id", input.transmissionId)
    .select("*")
    .single();

  if (error || !data) {
    throw new EditorialError(
      "editorial_unavailable",
      error?.message ?? "replace failed",
      503,
    );
  }
  return toSafeTransmission(data as TransmissionRow);
}

export async function approveTransmission(input: {
  transmissionId: string;
  admin?: SupabaseClient;
}): Promise<SafeEditorialTransmission> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data, error } = await admin
    .from("editorial_transmissions")
    .update({ approval_state: "approved" })
    .eq("id", input.transmissionId)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new EditorialError("editorial_unavailable", error.message, 503);
  }
  if (!data) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  return toSafeTransmission(data as TransmissionRow);
}

export async function incrementTransmissionCopyCount(input: {
  transmissionId: string;
  admin?: SupabaseClient;
}): Promise<SafeEditorialTransmission> {
  const admin = input.admin ?? (await defaultAdmin());
  const { data: existing, error: findError } = await admin
    .from("editorial_transmissions")
    .select("*")
    .eq("id", input.transmissionId)
    .maybeSingle();
  if (findError) {
    throw new EditorialError("editorial_unavailable", findError.message, 503);
  }
  if (!existing) {
    throw new EditorialError(
      "editorial_not_found",
      "Transmission not found",
      404,
    );
  }
  const next = (existing.copy_count ?? 0) + 1;
  const { data, error } = await admin
    .from("editorial_transmissions")
    .update({ copy_count: next })
    .eq("id", input.transmissionId)
    .select("*")
    .single();
  if (error || !data) {
    throw new EditorialError(
      "editorial_unavailable",
      error?.message ?? "copy count failed",
      503,
    );
  }
  return toSafeTransmission(data as TransmissionRow);
}
