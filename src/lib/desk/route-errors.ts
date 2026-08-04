import { DeedAuthoringError } from "@/lib/deeds/authoring-validation";
import { DeedModerationError } from "@/lib/deeds/moderation";
import { DeskAuthError } from "@/lib/desk/auth";
import { deskFacingGatheringError } from "@/lib/desk/gathering-facing-errors";
import { deskJson } from "@/lib/desk/http";
import {
  ChronicleError,
  deskFacingChronicleError,
} from "@/lib/chronicle/errors";
import {
  SpeaksTransformError,
  deskFacingSpeaksTransformError,
} from "@/lib/desk/speaks-transform";
import { CommonsError } from "@/lib/commons/errors";
import { EditorialError } from "@/lib/editorial/errors";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { TreasuryError } from "@/lib/treasury/errors";
import { WallError } from "@/lib/wall/errors";
import { XError } from "@/lib/x/errors";

/** Shared Desk API error mapper. */
export function mapDeskError(error: unknown, label: string): Response {
  if (error instanceof DeskAuthError) {
    if (
      error.reason !== "unauthenticated" &&
      error.reason !== "configuration_error"
    ) {
      console.info(`[${label}] denied`, { reason: error.reason });
    }
    return deskJson(
      { ok: false, error: "forbidden" },
      { status: error.status === 500 ? 500 : error.status },
    );
  }
  if (error instanceof DeedAuthoringError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof DeedModerationError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof WallError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof GreenwoodError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof TreasuryError) {
    return deskJson(
      { ok: false, error: "Treasury could not be read", code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ChronicleError) {
    console.error(`[${label}] chronicle`, {
      code: error.code,
      message: error.message,
    });
    return deskJson(
      {
        ok: false,
        error: deskFacingChronicleError(error),
        code: error.code,
      },
      { status: error.status },
    );
  }
  if (error instanceof SpeaksTransformError) {
    console.error(`[${label}] speaks-transform`, {
      code: error.code,
      message: error.message,
    });
    return deskJson(
      {
        ok: false,
        error: deskFacingSpeaksTransformError(error),
        code: error.code,
      },
      { status: error.status },
    );
  }
  if (error instanceof EditorialError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof CommonsError) {
    return deskJson(
      { ok: false, error: "Commons could not be read", code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof XError) {
    return deskJson(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(`[${label}] unexpected error`);
  return deskJson({ ok: false, error: "internal_error" }, { status: 500 });
}

/** Gathering Desk routes: Keeper-facing messages, no raw SQL/trigger leaks. */
export function mapDeskGatheringError(error: unknown, label: string): Response {
  if (error instanceof DeskAuthError) {
    if (
      error.reason !== "unauthenticated" &&
      error.reason !== "configuration_error"
    ) {
      console.info(`[${label}] denied`, { reason: error.reason });
    }
    return deskJson(
      {
        ok: false,
        error:
          error.reason === "unauthenticated"
            ? "Keeper access is required."
            : "forbidden",
      },
      { status: error.status === 500 ? 500 : error.status },
    );
  }
  if (error instanceof GreenwoodError) {
    console.error(`[${label}] gathering`, {
      code: error.code,
      message: error.message,
    });
    return deskJson(
      {
        ok: false,
        error: deskFacingGatheringError(error),
        code: error.code,
      },
      { status: error.status },
    );
  }
  return mapDeskError(error, label);
}
