/**
 * Fallback copy for FENN SPEAKS when the published DB message cannot be loaded.
 * Not the primary runtime source — see greenwood_fire_messages.
 */
export const GREENWOOD_FIRE_MESSAGE_FALLBACK = [
  "The fire is small.",
  "It has only just been lit.",
  "Those who arrive now will decide what it becomes.",
] as const;

/** @deprecated Use GREENWOOD_FIRE_MESSAGE_FALLBACK — primary source is the database. */
export const GREENWOOD_FIRE_MESSAGE = GREENWOOD_FIRE_MESSAGE_FALLBACK;

export const GREENWOOD_FIRE_ASCII = `
      )
     ) (
    (   )
     ) (
    (_._)
`.trim();

export const GREENWOOD_FIRE_MESSAGE_MAX_CHARS = 2000;

/** Split a stored plain-text body into display paragraphs. */
export function fireMessageBodyToParagraphs(body: string): string[] {
  const trimmed = body.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function paragraphsToFireMessageBody(lines: readonly string[]): string {
  return lines.map((l) => l.trim()).filter(Boolean).join("\n");
}

export type FireMessageBodyValidation =
  | { ok: true; body: string }
  | { ok: false; reason: "empty" | "too_long" };

/** Pure validation for operator-authored FENN SPEAKS bodies. */
export function validateFireMessageBodyInput(
  raw: string,
): FireMessageBodyValidation {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { ok: false, reason: "empty" };
  if (normalized.length > GREENWOOD_FIRE_MESSAGE_MAX_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, body: normalized };
}
