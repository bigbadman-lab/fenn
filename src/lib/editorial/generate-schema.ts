import { z } from "zod";

import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_MODES,
  EDITORIAL_PACKAGE_SIZE,
  categoryForMode,
  type EditorialCategory,
  type EditorialMode,
} from "@/lib/editorial/categories";
import type { EditorialDraftTransmission } from "@/lib/editorial/types";

const categoryEnum = z.enum(
  EDITORIAL_CATEGORIES as unknown as [EditorialCategory, ...EditorialCategory[]],
);

const modeEnum = z.enum(
  EDITORIAL_MODES as unknown as [EditorialMode, ...EditorialMode[]],
);

export const editorialTransmissionModelSchema = z.object({
  mode: modeEnum,
  category: categoryEnum.optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  operatorRationale: z.string().min(1).max(500),
  sourceSignals: z.array(z.string().min(1).max(64)).max(12),
  confidence: z.enum(["high", "medium", "low"]),
  grounded: z.boolean().optional().default(false),
});

export const editorialPackageModelSchema = z.object({
  transmissions: z
    .array(editorialTransmissionModelSchema)
    .length(EDITORIAL_PACKAGE_SIZE),
});

export const editorialSingleModelSchema = z.object({
  transmission: editorialTransmissionModelSchema,
});

/** Recovery may return a partial slot list. */
export const editorialRecoveryModelSchema = z.object({
  repairs: z
    .array(
      editorialTransmissionModelSchema.extend({
        index: z.number().int().min(0).max(EDITORIAL_PACKAGE_SIZE - 1),
      }),
    )
    .min(1)
    .max(EDITORIAL_PACKAGE_SIZE),
});

export function assertNoAuthorityFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const banned = [
    "privateKey",
    "seedPhrase",
    "mnemonic",
    "apiKey",
    "OPENAI_API_KEY",
    "walletAddress",
    "email",
    "accessToken",
  ];
  const raw = JSON.stringify(value);
  for (const key of banned) {
    if (raw.includes(key)) {
      throw new Error(`Model output contained forbidden field pattern: ${key}`);
    }
  }
}

function toDraft(
  t: z.infer<typeof editorialTransmissionModelSchema>,
  forcedMode?: EditorialMode,
): EditorialDraftTransmission {
  const mode = forcedMode ?? t.mode;
  return {
    mode,
    category: categoryForMode(mode),
    title: t.title.trim(),
    body: t.body.replace(/\r\n/g, "\n").trim(),
    operatorRationale: t.operatorRationale.trim(),
    sourceSignals: t.sourceSignals.map((s) => s.trim()).filter(Boolean),
    confidence: t.confidence,
    grounded: Boolean(t.grounded),
  };
}

export function parsePackageModelOutput(raw: unknown): {
  transmissions: EditorialDraftTransmission[];
} {
  const parsed = editorialPackageModelSchema.parse(raw);
  return {
    transmissions: parsed.transmissions.map((t) => toDraft(t)),
  };
}

export function parseSingleModelOutput(raw: unknown): EditorialDraftTransmission {
  const parsed = editorialSingleModelSchema.parse(raw);
  return toDraft(parsed.transmission);
}

export function parseRecoveryModelOutput(raw: unknown): Array<{
  index: number;
  draft: EditorialDraftTransmission;
}> {
  const parsed = editorialRecoveryModelSchema.parse(raw);
  return parsed.repairs.map((r) => ({
    index: r.index,
    draft: toDraft(r),
  }));
}
