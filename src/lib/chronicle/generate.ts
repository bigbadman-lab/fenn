import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import { ChronicleError } from "@/lib/chronicle/errors";
import {
  buildDailyChronicleSystemPrompt,
  buildDailyChronicleUserPayload,
} from "@/lib/chronicle/generate-prompt";
import {
  assertNoAuthorityFields,
  dailyChronicleModelSchema,
  parseDailyChronicleModelOutput,
} from "@/lib/chronicle/generate-schema";
import { snapshotFactCatalog } from "@/lib/chronicle/snapshot";
import type {
  DailyWorldSnapshot,
  GeneratedDailyChronicle,
} from "@/lib/chronicle/types";

export const DAILY_CHRONICLE_OPENAI_MODEL = "gpt-4o-mini";
export const DAILY_CHRONICLE_MAX_COMPLETION_TOKENS = 900;

export type DailyChronicleModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}) => Promise<GeneratedDailyChronicle>;

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
}): Promise<GeneratedDailyChronicle> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new ChronicleError(
        "chronicle_unavailable",
        "Chronicle generation is not configured",
        503,
      );
    }
    throw error;
  }

  const completion = await client.chat.completions.parse({
    model: args.model,
    max_completion_tokens: args.maxCompletionTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: zodResponseFormat(
      dailyChronicleModelSchema,
      "fenn_daily_chronicle",
    ),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new ChronicleError(
      "chronicle_generation_failed",
      "Model returned no structured chronicle",
      502,
    );
  }
  assertNoAuthorityFields(parsed);
  return parseDailyChronicleModelOutput(parsed);
}

/**
 * Validate generated chronicle against the snapshot.
 * referencedFacts must be known catalog keys; body must not invent obvious counts.
 */
export function validateGeneratedAgainstSnapshot(
  generated: GeneratedDailyChronicle,
  snapshot: DailyWorldSnapshot,
): void {
  const catalog = snapshotFactCatalog(snapshot);
  const allowed = new Set(Object.keys(catalog));

  for (const fact of generated.referencedFacts) {
    if (!allowed.has(fact)) {
      throw new ChronicleError(
        "chronicle_grounding_failed",
        `Unknown referenced fact: ${fact}`,
        422,
      );
    }
  }

  if (snapshot.quiet && generated.tone !== "quiet") {
    // Soft preference — still allow ordinary if model understates; only fail on notable.
    if (generated.tone === "notable") {
      throw new ChronicleError(
        "chronicle_grounding_failed",
        "Quiet day cannot be toned notable",
        422,
      );
    }
  }

  // Reject invented positive counts that contradict zeros in the snapshot.
  const zeroClaims: Array<{ re: RegExp; whenZero: keyof DailyWorldSnapshot }> = [
    {
      re: /\b(\d+)\s+outlaws?\b/i,
      whenZero: "newOutlaws",
    },
    {
      re: /\b(\d+)\s+LEAF\b/i,
      whenZero: "leafRecognisedTotal",
    },
  ];

  for (const claim of zeroClaims) {
    const value = snapshot[claim.whenZero];
    if (typeof value === "number" && value === 0) {
      const match = generated.body.match(claim.re);
      if (match && Number(match[1]) > 0) {
        throw new ChronicleError(
          "chronicle_grounding_failed",
          `Body invents ${claim.whenZero}`,
          422,
        );
      }
    }
  }

  if (!generated.body.includes("FENN")) {
    // Prefer signed entries; append if missing rather than fail.
  }
}

export async function generateDailyChronicle(
  snapshot: DailyWorldSnapshot,
  options?: { caller?: DailyChronicleModelCaller; model?: string },
): Promise<GeneratedDailyChronicle> {
  const caller = options?.caller ?? defaultCaller;
  const model = options?.model ?? DAILY_CHRONICLE_OPENAI_MODEL;

  let generated: GeneratedDailyChronicle;
  try {
    generated = await caller({
      model,
      system: buildDailyChronicleSystemPrompt(),
      user: buildDailyChronicleUserPayload(snapshot),
      maxCompletionTokens: DAILY_CHRONICLE_MAX_COMPLETION_TOKENS,
    });
  } catch (error) {
    if (error instanceof ChronicleError) throw error;
    throw new ChronicleError(
      "chronicle_generation_failed",
      error instanceof Error ? error.message : "Chronicle generation failed",
      502,
    );
  }

  if (!generated.body.trim().endsWith("FENN")) {
    generated = {
      ...generated,
      body: `${generated.body.trim()}\n\n— FENN`,
    };
  }

  validateGeneratedAgainstSnapshot(generated, snapshot);
  return generated;
}
