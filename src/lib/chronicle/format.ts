import { formatChronicleDateHeading } from "@/lib/chronicle/dates";
import {
  CHRONICLE_AUTHOR_NAME,
  CHRONICLE_AUTHOR_SIGNATURE,
  type PublicChronicleEntry,
} from "@/lib/chronicle/types";

/** Normalize legacy FENN signatures when rendering public Book entries. */
export function formatChronicleBodyDisplay(body: string): string {
  return body
    .replace(/\n\n— FENN\s*$/u, `\n\n${CHRONICLE_AUTHOR_SIGNATURE}`)
    .replace(/\n— FENN\s*$/u, `\n${CHRONICLE_AUTHOR_SIGNATURE}`)
    .replace(/\n\n— VELL\s*$/u, `\n\n${CHRONICLE_AUTHOR_SIGNATURE}`)
    .trimEnd();
}

export function chronicleBodyEndsWithAuthorSignature(body: string): boolean {
  const trimmed = body.trim();
  return (
    trimmed.endsWith(CHRONICLE_AUTHOR_NAME) ||
    trimmed.endsWith(CHRONICLE_AUTHOR_SIGNATURE) ||
    trimmed.endsWith("— FENN")
  );
}

export function chronicleEntryHeading(entry: PublicChronicleEntry): string {
  if (entry.kind === "daily" && entry.coveredDate) {
    return formatChronicleDateHeading(entry.coveredDate);
  }
  const d = new Date(entry.publishedAt);
  if (Number.isNaN(d.getTime())) return entry.title ?? "CHRONICLE";
  return formatChronicleDateHeading(
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
  );
}

export function chronicleKindLabel(entry: PublicChronicleEntry): string {
  return entry.kind === "daily" ? "daily" : "chronicle";
}
