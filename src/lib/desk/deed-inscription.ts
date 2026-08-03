/**
 * Safe default Wall inscription for an approved Deed submission.
 * Uses only Desk-safe public-facing fields — never private evidence.
 */

export type DeedWallInscriptionInput = {
  deedTitle: string;
  displayName: string | null | undefined;
  leafAwarded: number | null | undefined;
};

export function buildDefaultDeedWallInscription(
  input: DeedWallInscriptionInput,
): string {
  const outlaw =
    input.displayName?.trim() && input.displayName.trim().length > 0
      ? input.displayName.trim()
      : "An outlaw";
  const title =
    input.deedTitle?.trim() && input.deedTitle.trim().length > 0
      ? input.deedTitle.trim()
      : "a Deed";

  const lines = [
    "A DEED WAS COMPLETED",
    "",
    `${outlaw} answered the call:`,
    title,
    "",
    "The proof was examined.",
    "The work was accepted.",
  ];

  if (
    input.leafAwarded != null &&
    Number.isInteger(input.leafAwarded) &&
    input.leafAwarded > 0
  ) {
    lines.push("");
    lines.push(`${input.leafAwarded} LEAF carried forward.`);
  }

  lines.push("");
  lines.push("— FENN");
  return lines.join("\n");
}
