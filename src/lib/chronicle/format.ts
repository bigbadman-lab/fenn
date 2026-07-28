import { formatChronicleDateHeading } from "@/lib/chronicle/dates";
import type { PublicChronicleEntry } from "@/lib/chronicle/types";

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
