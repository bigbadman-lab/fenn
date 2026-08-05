import { NextResponse } from "next/server";

import {
  DeskAuthError,
  requireFennDeskAccess,
} from "@/lib/desk/auth";
import { ClearingError } from "@/lib/clearing/errors";
import {
  hideClearingMessage,
  setOutlawModeration,
  setTravellerModeration,
  unhideClearingMessage,
} from "@/lib/clearing/moderation";
import { updateClearingState } from "@/lib/clearing/state";
import { isClearingUuid } from "@/lib/clearing/cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clearing/moderation
 * Desk-only moderation actions. No UI in this stage.
 *
 * body.action:
 *   hide | unhide | mute_traveller | ban_traveller |
 *   mute_outlaw | ban_outlaw | unmute_traveller | unban_traveller |
 *   unmute_outlaw | unban_outlaw | set_state
 */
export async function POST(request: Request) {
  try {
    const desk = await requireFennDeskAccess(request);

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
      reason?: string | null;
      readOnly?: boolean;
      slowModeSeconds?: number;
    };

    const action = payload.action?.trim();
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "action required", code: "clearing_invalid_request" },
        { status: 400 },
      );
    }

    switch (action) {
      case "hide": {
        if (!payload.messageId || !isClearingUuid(payload.messageId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "messageId required",
            400,
          );
        }
        await hideClearingMessage({
          messageId: payload.messageId,
          hiddenBy: desk.profileId,
          reason: payload.reason,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "unhide": {
        if (!payload.messageId || !isClearingUuid(payload.messageId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "messageId required",
            400,
          );
        }
        await unhideClearingMessage({ messageId: payload.messageId });
        return NextResponse.json({ ok: true, action });
      }
      case "mute_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        await setTravellerModeration({
          travellerId: payload.travellerId,
          mutedUntil:
            payload.mutedUntil ??
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        return NextResponse.json({ ok: true, action });
      }
      case "unmute_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        await setTravellerModeration({
          travellerId: payload.travellerId,
          mutedUntil: null,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "ban_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        await setTravellerModeration({
          travellerId: payload.travellerId,
          banned: true,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "unban_traveller": {
        if (!payload.travellerId || !isClearingUuid(payload.travellerId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "travellerId required",
            400,
          );
        }
        await setTravellerModeration({
          travellerId: payload.travellerId,
          banned: false,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "mute_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        await setOutlawModeration({
          profileId: payload.profileId,
          mutedUntil:
            payload.mutedUntil ??
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          updatedBy: desk.profileId,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "unmute_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        await setOutlawModeration({
          profileId: payload.profileId,
          mutedUntil: null,
          updatedBy: desk.profileId,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "ban_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        await setOutlawModeration({
          profileId: payload.profileId,
          banned: true,
          updatedBy: desk.profileId,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "unban_outlaw": {
        if (!payload.profileId || !isClearingUuid(payload.profileId)) {
          throw new ClearingError(
            "clearing_invalid_request",
            "profileId required",
            400,
          );
        }
        await setOutlawModeration({
          profileId: payload.profileId,
          banned: false,
          updatedBy: desk.profileId,
        });
        return NextResponse.json({ ok: true, action });
      }
      case "set_state": {
        const state = await updateClearingState({
          readOnly: payload.readOnly,
          slowModeSeconds: payload.slowModeSeconds,
          updatedBy: desk.profileId,
        });
        return NextResponse.json({ ok: true, action, state });
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
