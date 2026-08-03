import { z } from "zod";

import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_PACKAGE_SIZE,
  type EditorialCategory,
} from "@/lib/editorial/categories";
import type { EditorialDraftTransmission } from "@/lib/editorial/types";

const categoryEnum = z.enum(
  EDITORIAL_CATEGORIES as unknown as [EditorialCategory, ...EditorialCategory[]],
);

export const editorialTransmissionModelSchema = z.object({
  category: categoryEnum,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
  operatorRationale: z.string().min(1).max(500),
  sourceSignals: z.array(z.string().min(1).max(64)).max(12),
  confidence: z.enum(["high", "medium", "low"]),
});

export const editorialPackageModelSchema = z.object({
  transmissions: z
    .array(editorialTransmissionModelSchema)
    .length(EDITORIAL_PACKAGE_SIZE),
});

export const editorialSingleModelSchema = z.object({
  transmission: editorialTransmissionModelSchema,
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

export function parsePackageModelOutput(raw: unknown): {
  transmissions: EditorialDraftTransmission[];
} {
  const parsed = editorialPackageModelSchema.parse(raw);
  return {
    transmissions: parsed.transmissions.map((t) => ({
      category: t.category,
      title: t.title.trim(),
      body: t.body.replace(/\r\n/g, "\n").trim(),
      operatorRationale: t.operatorRationale.trim(),
      sourceSignals: t.sourceSignals.map((s) => s.trim()).filter(Boolean),
      confidence: t.confidence,
    })),
  };
}

export function parseSingleModelOutput(raw: unknown): EditorialDraftTransmission {
  const parsed = editorialSingleModelSchema.parse(raw);
  const t = parsed.transmission;
  return {
    category: t.category,
    title: t.title.trim(),
    body: t.body.replace(/\r\n/g, "\n").trim(),
    operatorRationale: t.operatorRationale.trim(),
    sourceSignals: t.sourceSignals.map((s) => s.trim()).filter(Boolean),
    confidence: t.confidence,
  };
}
