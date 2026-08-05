import { NextResponse } from "next/server";

import {
  DeskAuthError,
  requireFennDeskAccess,
} from "@/lib/desk/auth";
import { isClearingUuid } from "@/lib/clearing/cookie";
import {
  deskActorLabel,
  logClearingModeration,
} from "@/lib/clearing/desk-ops";
import {
  isAllowedSlowModeSeconds,
  muteUntilFromPresetSeconds,
} from "@/lib/clearing/desk-types";
import { ClearingError } from "@/lib/clearing/errors";
import {
  hideClearingMessage,
  setOutlawModeration,
  setTravellerModeration,
  unhideClearingMessage,
} from "@/lib/clearing/moderation";
import { updateClearingState } from "@/lib/clearing/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clearing/moderation
 * Desk-only moderation actions with durable audit log.
 *
 * body.action:
 *   hide | unhide | mute_traveller | ban_traveller |
 *   mute_outlaw | ban_outlaw | unmute_traveller | unban_traveller |
 *   unmute_outlaw | unban_outlaw | set_state
 */
export async function POST(request: Request) {
  try {
    const desk = await requireFennDeskAccess(request);
    const actorLabel = deskActorLabel({
      outlawAlias: desk.outlawAlias,
      outlawNumber: desk.outlawNumber,
    });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON", code: "clearing_invalid_request" },
        { status: 400 },
      );
    }

    const payload = body as {
      action?: string;
      messageId?: string;
      travellerId?: string;
      profileId?: string;
      mutedUntil?: string | null;
      muteSeconds?: number;
      reason?: string | null;
      readOnly?: boolean;
      slowModeSeconds?: number;
      targetLabel?: string | null;
    };

    const action = payload.action?.trim();
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "action required", code: "clearing_invalid_request" },
        { status: 400 },
      );
    }

    const reason = payload.reason?.trim().slice(0, 500) || null;

    const resolveMuteUntil = (): string => {
      if (
        typeof payload.muteSeconds === "number" &&
        Number.isFinite(payload.muteSeconds) &&
        payload.muteSeconds > 0 &&
        payload.muteSeconds <= 7 * 24 * 60 * 60
      ) {
        return muteUntilFromPresetSeconds(Math.trunc(payload.muteSeconds));
      }
      if (payload.mutedUntil && typeof payload.mutedUntil === "string") {
        const t = Date.parse(payload.mutedUntil);
        if (!Number.isNaN(t) && t > Date.now()) {
          return new Date(t).toISOString();
        }
      }
      return muteUntilFromPresetSeconds(24 * 60 * 60);
    };

    switch (action) {
      case "hide": {
        if (!payload.messageId || !isClearingUuid(payload.messageId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "messageId required",
            400,
          );
        }
        const result = await hideClearingMessage({
          messageId: payload.messageId,
          hiddenBy: desk.profileId,
          reason,
        });
        if (result.previousStatus !== "hidden") {
          await logClearingModeration({
            action: "hide",
            actorProfileId: desk.profileId,
            actorLabel,
            messageId: payload.messageId,
            targetLabel: result.authorLabel,
            previousState: { status: result.previousStatus },
            nextState: { status: "hidden" },
            reason,
          });
        }
        return NextResponse.json({
          ok: true,
          action,
          message: "THE MESSAGE IS HIDDEN.",
        });
      }
      case "unhide": {
        if (!payload.messageId || !isClearingUuid(payload.messageId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "messageId required",
            400,
          );
        }
        const result = await unhideClearingMessage({
          messageId: payload.messageId,
        });
        if (result.previousStatus === "hidden") {
          await logClearingModeration({
            action: "unhide",
            actorProfileId: desk.profileId,
            actorLabel,
            messageId: payload.messageId,
            targetLabel: result.authorLabel,
            previousState: { status: "hidden" },
            nextState: { status: "published" },
            reason,
          });
        }
        return NextResponse.json({
          ok: true,
          action,
          message: "THE MESSAGE IS RESTORED.",
        });
      }
      case "mute_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        const until = resolveMuteUntil();
        const result = await setTravellerModeration({
          travellerId: payload.travellerId,
          mutedUntil: until,
        });
        await logClearingModeration({
          action: "mute_traveller",
          actorProfileId: desk.profileId,
          actorLabel,
          travellerId: payload.travellerId,
          targetLabel: result.displayName,
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE TRAVELLER HAS BEEN SILENCED.",
        });
      }
      case "unmute_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        const result = await setTravellerModeration({
          travellerId: payload.travellerId,
          mutedUntil: null,
        });
        await logClearingModeration({
          action: "unmute_traveller",
          actorProfileId: desk.profileId,
          actorLabel,
          travellerId: payload.travellerId,
          targetLabel: result.displayName,
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE TRAVELLER MAY SPEAK AGAIN.",
        });
      }
      case "ban_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        const result = await setTravellerModeration({
          travellerId: payload.travellerId,
          banned: true,
        });
        await logClearingModeration({
          action: "ban_traveller",
          actorProfileId: desk.profileId,
          actorLabel,
          travellerId: payload.travellerId,
          targetLabel: result.displayName,
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THIS TRAVELLER ROAD IS CLOSED.",
        });
      }
      case "unban_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        const result = await setTravellerModeration({
          travellerId: payload.travellerId,
          banned: false,
        });
        await logClearingModeration({
          action: "unban_traveller",
          actorProfileId: desk.profileId,
          actorLabel,
          travellerId: payload.travellerId,
          targetLabel: result.displayName,
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE TRAVELLER ROAD IS OPEN AGAIN.",
        });
      }
      case "mute_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        const until = resolveMuteUntil();
        const result = await setOutlawModeration({
          profileId: payload.profileId,
          mutedUntil: until,
          updatedBy: desk.profileId,
        });
        await logClearingModeration({
          action: "mute_outlaw",
          actorProfileId: desk.profileId,
          actorLabel,
          profileId: payload.profileId,
          targetLabel: payload.targetLabel?.slice(0, 120) ?? "Outlaw",
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE OUTLAW VOICE IS SILENCED IN THE CLEARING.",
        });
      }
      case "unmute_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        const result = await setOutlawModeration({
          profileId: payload.profileId,
          mutedUntil: null,
          updatedBy: desk.profileId,
        });
        await logClearingModeration({
          action: "unmute_outlaw",
          actorProfileId: desk.profileId,
          actorLabel,
          profileId: payload.profileId,
          targetLabel: payload.targetLabel?.slice(0, 120) ?? "Outlaw",
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE OUTLAW MAY SPEAK IN THE CLEARING AGAIN.",
        });
      }
      case "ban_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        const result = await setOutlawModeration({
          profileId: payload.profileId,
          banned: true,
          updatedBy: desk.profileId,
        });
        await logClearingModeration({
          action: "ban_outlaw",
          actorProfileId: desk.profileId,
          actorLabel,
          profileId: payload.profileId,
          targetLabel: payload.targetLabel?.slice(0, 120) ?? "Outlaw",
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THIS OUTLAW VOICE IS CLOSED IN THE CLEARING.",
        });
      }
      case "unban_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        const result = await setOutlawModeration({
          profileId: payload.profileId,
          banned: false,
          updatedBy: desk.profileId,
        });
        await logClearingModeration({
          action: "unban_outlaw",
          actorProfileId: desk.profileId,
          actorLabel,
          profileId: payload.profileId,
          targetLabel: payload.targetLabel?.slice(0, 120) ?? "Outlaw",
          previousState: result.previous,
          nextState: result.next,
          reason,
        });
        return NextResponse.json({
          ok: true,
          action,
          message: "THE OUTLAW VOICE MAY RETURN TO THE CLEARING.",
        });
      }
      case "set_state": {
        if (
          payload.slowModeSeconds !== undefined &&
          !isAllowedSlowModeSeconds(payload.slowModeSeconds)
        ) {
          throw new ClearingError(
            "clearing_invalid_request",
            "slow_mode_seconds must be 0, 3, 5, 10, 30, or 60",
            400,
          );
        }
        if (
          payload.readOnly === undefined &&
          payload.slowModeSeconds === undefined
        ) {
          throw new ClearingError(
            "clearing_invalid_request",
            "readOnly or slowModeSeconds required",
            400,
          );
        }
        const state = await updateClearingState({
          readOnly: payload.readOnly,
          slowModeSeconds: payload.slowModeSeconds,
          updatedBy: desk.profileId,
        });
        await logClearingModeration({
          action: "set_state",
          actorProfileId: desk.profileId,
          actorLabel,
          targetLabel: "clearing_state",
          previousState: {
            readOnly: state.previous.readOnly,
            slowModeSeconds: state.previous.slowModeSeconds,
          },
          nextState: {
            readOnly: state.readOnly,
            slowModeSeconds: state.slowModeSeconds,
          },
          reason,
        });
        const message =
          payload.readOnly === true
            ? "THE CLEARING HAS BEEN CLOSED TO NEW VOICES."
            : payload.readOnly === false
              ? "THE CLEARING IS OPEN TO VOICES AGAIN."
              : "SLOW MODE HAS BEEN SET.";
        return NextResponse.json({
          ok: true,
          action,
          state: {
            readOnly: state.readOnly,
            slowModeSeconds: state.slowModeSeconds,
            updatedAt: state.updatedAt,
          },
          message,
        });
      }
      default:
        return NextResponse.json(
          {
            ok: false,
            error: "Unknown action",
            code: "clearing_invalid_request",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof DeskAuthError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.reason },
        { status: error.status },
      );
    }
    if (error instanceof ClearingError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/clearing/moderation]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "clearing_internal" },
      { status: 500 },
    );
  }
}
