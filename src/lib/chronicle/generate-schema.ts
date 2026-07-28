import { z } from "zod";

import type { GeneratedDailyChronicle } from "@/lib/chronicle/types";

export const dailyChronicleModelSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(8000),
  referencedFacts: z.array(z.string().min(1).max(64)).max(32),
  tone: z.enum(["quiet", "ordinary", "notable"]),
});

export type DailyChronicleModelOutput = z.infer<typeof dailyChronicleModelSchema>;

export function parseDailyChronicleModelOutput(
  value: unknown,
): GeneratedDailyChronicle {
  const parsed = dailyChronicleModelSchema.parse(value);
  return {
    title: parsed.title.trim(),
    body: parsed.body.replace(/\s+$/u, ""),
    referencedFacts: parsed.referencedFacts.map((f) => f.trim()),
    tone: parsed.tone,
  };
}

export function assertNoAuthorityFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const banned = [
    "leafAward",
    "executeEffect",
    "transfer",
    "wallet",
    "privateKey",
    "prompt",
  ];
  for (const key of Object.keys(value as object)) {
    if (banned.includes(key)) {
      throw new Error(`Forbidden authority field in chronicle output: ${key}`);
    }
  }
}
