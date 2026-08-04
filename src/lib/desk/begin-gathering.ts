import "server-only";

import { deskFacingGatheringError } from "@/lib/desk/gathering-facing-errors";
import { getDeskGatheringDetail } from "@/lib/desk/gatherings";
import type { DeskGatheringDetail } from "@/lib/desk/gatherings-types";
import { GreenwoodError } from "@/lib/greenwood/errors";
import {
  parseGatheringAnnouncementStyle,
  type GatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  GATHERING_DURATION_MAX_MINUTES,
  GATHERING_DURATION_MIN_MINUTES,
  isValidGatheringDurationMinutes,
} from "@/lib/greenwood/gatherings/duration";
import {
  adminCancelGathering,
  adminCreateGatheringDraft,
  adminPublishGathering,
  adminUpdateGatheringDraft,
} from "@/lib/greenwood/gatherings/admin-ops";

export type BeginGatheringInput = {
  title: string;
  summary: string;
  durationMinutes: number;
  capacity?: number | null;
  rewardLeafPreview?: number | null;
  announcementStyle?: GatheringAnnouncementStyle | string | null;
  /** Resume an unfinished draft with new server times. */
  draftId?: string | null;
};

function validateCapacity(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 10_000) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Capacity must be a positive whole number",
      400,
    );
  }
  return n;
}

function validateRewardPreview(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Possible Hollow reward preview is invalid",
      400,
    );
  }
  return n;
}

export function parseBeginGatheringBody(body: unknown): BeginGatheringInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Invalid Gathering request",
      400,
    );
  }
  const raw = body as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!title) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Title is required",
      400,
    );
  }
  if (!summary) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Summary is required",
      400,
    );
  }

  const durationMinutes =
    typeof raw.durationMinutes === "number"
      ? raw.durationMinutes
      : Number(raw.durationMinutes);
  if (!isValidGatheringDurationMinutes(durationMinutes)) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      `Duration must be a whole number between ${GATHERING_DURATION_MIN_MINUTES} and ${GATHERING_DURATION_MAX_MINUTES} minutes`,
      400,
    );
  }

  const style = parseGatheringAnnouncementStyle(raw.announcementStyle);
  const draftId =
    typeof raw.draftId === "string" && raw.draftId.trim()
      ? raw.draftId.trim()
      : null;

  return {
    title,
    summary,
    durationMinutes,
    capacity: validateCapacity(raw.capacity),
    rewardLeafPreview: validateRewardPreview(raw.rewardLeafPreview),
    announcementStyle: style,
    draftId,
  };
}

/**
 * Create + publish a Gathering immediately with server-authoritative times.
 * Does not trust client start/end timestamps.
 */
export async function deskBeginGathering(
  input: BeginGatheringInput,
  actorId: string,
  nowMs: number = Date.now(),
): Promise<DeskGatheringDetail> {
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title || !summary) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "Title and summary are required",
      400,
    );
  }
  if (!isValidGatheringDurationMinutes(input.durationMinutes)) {
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      `Duration must be a whole number between ${GATHERING_DURATION_MIN_MINUTES} and ${GATHERING_DURATION_MAX_MINUTES} minutes`,
      400,
    );
  }

  const style = parseGatheringAnnouncementStyle(input.announcementStyle);
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(
    nowMs + input.durationMinutes * 60_000,
  ).toISOString();

  let gatheringId: string | null = null;
  let createdInThisCall = false;

  try {
    if (input.draftId) {
      gatheringId = input.draftId;
      await adminUpdateGatheringDraft(
        gatheringId,
        {
          title,
          summary,
          startsAt,
          endsAt,
          capacity: input.capacity ?? null,
          rewardLeafPreview: input.rewardLeafPreview ?? null,
          announcementStyle: style,
        },
        actorId,
      );
    } else {
      const draft = await adminCreateGatheringDraft(
        {
          title,
          summary,
          startsAt,
          endsAt,
          capacity: input.capacity ?? null,
          rewardLeafPreview: input.rewardLeafPreview ?? null,
          announcementStyle: style,
        },
        actorId,
      );
      gatheringId = draft.id;
      createdInThisCall = true;
    }

    await adminPublishGathering(gatheringId, actorId);
    return getDeskGatheringDetail(gatheringId, Date.now());
  } catch (error) {
    console.error("[deskBeginGathering] failed", {
      draftId: gatheringId,
      createdInThisCall,
      code: error instanceof GreenwoodError ? error.code : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });

    // Leave unfinished draft for recovery when create succeeded but publish failed.
    // Overlap on publish still leaves a recoverable draft rather than a live Gathering.
    if (error instanceof GreenwoodError) {
      throw new GreenwoodError(
        error.code,
        deskFacingGatheringError(error),
        error.status,
        { cause: error },
      );
    }
    throw new GreenwoodError(
      "greenwood_gathering_failed",
      "The Gathering could not be called.",
      500,
      { cause: error },
    );
  }
}

/** Soft-cancel a stuck draft when explicitly requested (optional cleanup). */
export async function deskAbandonUnfinishedDraft(
  draftId: string,
  actorId: string,
  reason: string | null = "Abandoned unfinished call",
) {
  return adminCancelGathering(draftId, actorId, reason);
}
