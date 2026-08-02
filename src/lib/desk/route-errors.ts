import { DeedModerationError } from "@/lib/deeds/moderation";
import { DeskAuthError } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { ChronicleError } from "@/lib/chronicle/errors";
import { CommonsError } from "@/lib/commons/errors";
import { GreenwoodError } from "@/lib/greenwood/errors";
import { TreasuryError } from "@/lib/treasury/errors";
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
  if (error instanceof DeedModerationError) {
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

/** Alias kept for existing Gathering routes. */
export function mapDeskGatheringError(error: unknown, label: string): Response {
  return mapDeskError(error, label);
}
