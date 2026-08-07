import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import { orderedModeSlots, type EditorialMode } from "@/lib/editorial/categories";
import { EditorialError } from "@/lib/editorial/errors";
import {
  buildEditorialPackageSystemPrompt,
  buildEditorialPackageUserPayload,
  buildEditorialRecoverySystemPrompt,
  buildEditorialRecoveryUserPayload,
  buildEditorialRegenerateSystemPrompt,
  buildEditorialRegenerateUserPayload,
} from "@/lib/editorial/generate-prompt";
import {
  assertNoAuthorityFields,
  editorialPackageModelSchema,
  editorialRecoveryModelSchema,
  editorialSingleModelSchema,
  parsePackageModelOutput,
  parseRecoveryModelOutput,
  parseSingleModelOutput,
} from "@/lib/editorial/generate-schema";
import {
  assessEditorialPackage,
  validateEditorialPackageStructure,
  validateSingleTransmission,
} from "@/lib/editorial/quality";
import type {
  EditorialBrief,
  EditorialContextPack,
  EditorialDraftTransmission,
  EditorialGeneratedPackage,
} from "@/lib/editorial/types";
import {
  EDITORIAL_OPENAI_MODEL,
  EDITORIAL_PACKAGE_MAX_COMPLETION_TOKENS,
  EDITORIAL_RECOVERY_MAX_COMPLETION_TOKENS,
  EDITORIAL_SINGLE_MAX_COMPLETION_TOKENS,
} from "@/lib/editorial/types";
import { categoryForMode } from "@/lib/editorial/categories";

export type EditorialModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
  mode: "package" | "single" | "recovery";
}) => Promise<unknown>;

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
  mode: "package" | "single" | "recovery";
}): Promise<unknown> {
  const { getOpenAIClient, OpenAIUnavailableError } = await import(
    "@/lib/ai/openai"
  );
  let client;
  try {
    client = getOpenAIClient();
  } catch (error) {
    if (error instanceof OpenAIUnavailableError) {
      throw new EditorialError(
        "editorial_unavailable",
        "Editorial generation is not configured",
        503,
      );
    }
    throw error;
  }

  const schema =
    args.mode === "package"
      ? editorialPackageModelSchema
      : args.mode === "recovery"
        ? editorialRecoveryModelSchema
        : editorialSingleModelSchema;
  const name =
    args.mode === "package"
      ? "fenn_editorial_package"
      : args.mode === "recovery"
        ? "fenn_editorial_recovery"
        : "fenn_editorial_transmission";

  let completion;
  try {
    completion = await client.chat.completions.parse({
      model: args.model,
      max_completion_tokens: args.maxCompletionTokens,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: zodResponseFormat(schema, name),
    });
  } catch (error) {
    console.error("[editorial] openai structured call failed", {
      mode: args.mode,
      model: args.model,
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message.slice(0, 400) : "unknown",
    });
    throw new EditorialError(
      "editorial_generation_failed",
      "Editorial package generation failed",
      502,
    );
  }

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message?.refusal;
    console.error("[editorial] model returned no structured output", {
      mode: args.mode,
      refusal: typeof refusal === "string" ? refusal.slice(0, 200) : null,
      finishReason: completion.choices[0]?.finish_reason ?? null,
    });
    throw new EditorialError(
      "editorial_generation_failed",
      "Model returned no structured editorial output",
      502,
    );
  }
  assertNoAuthorityFields(parsed);
  return parsed;
}

function forceSlotModes(
  transmissions: EditorialDraftTransmission[],
): EditorialDraftTransmission[] {
  const slots = orderedModeSlots();
  return transmissions.map((t, i) => {
    const mode = slots[i] ?? t.mode;
    return {
      ...t,
      mode,
      category: categoryForMode(mode),
    };
  });
}

/**
 * Single structured model call → full 30-transmission package.
 * At most one recovery pass for quality failures.
 */
export async function generateEditorialPackage(input: {
  pack: EditorialContextPack;
  brief: EditorialBrief;
  caller?: EditorialModelCaller;
}): Promise<EditorialGeneratedPackage> {
  const caller = input.caller ?? defaultCaller;
  let raw: unknown;
  try {
    raw = await caller({
      model: EDITORIAL_OPENAI_MODEL,
      system: buildEditorialPackageSystemPrompt(),
      user: buildEditorialPackageUserPayload({
        pack: input.pack,
        brief: input.brief,
      }),
      maxCompletionTokens: EDITORIAL_PACKAGE_MAX_COMPLETION_TOKENS,
      mode: "package",
    });
  } catch (error) {
    if (error instanceof EditorialError) throw error;
    throw new EditorialError(
      "editorial_generation_failed",
      "Editorial package generation failed",
      502,
    );
  }

  let transmissions: EditorialDraftTransmission[];
  try {
    ({ transmissions } = parsePackageModelOutput(raw));
    transmissions = forceSlotModes(transmissions);
  } catch {
    throw new EditorialError(
      "editorial_generation_failed",
      "Editorial package could not be parsed",
      502,
    );
  }

  let assessment = assessEditorialPackage(transmissions, input.pack.world);
  if (assessment.structuralErrors.length > 0) {
    throw new EditorialError(
      "editorial_validation_failed",
      assessment.structuralErrors[0]!,
      422,
    );
  }

  let recoveryUsed = false;

  if (assessment.qualityFailures.length > 0) {
    recoveryUsed = true;
    const failures = assessment.qualityFailures.map((f) => ({
      index: f.index,
      mode: transmissions[f.index]!.mode,
      body: transmissions[f.index]!.body,
      reasons: f.reasons,
    }));

    let recoveryRaw: unknown;
    try {
      recoveryRaw = await caller({
        model: EDITORIAL_OPENAI_MODEL,
        system: buildEditorialRecoverySystemPrompt(),
        user: buildEditorialRecoveryUserPayload({
          pack: input.pack,
          brief: input.brief,
          failures,
          neighbourBodies: transmissions.map((t) => t.body),
        }),
        maxCompletionTokens: EDITORIAL_RECOVERY_MAX_COMPLETION_TOKENS,
        mode: "recovery",
      });
    } catch (error) {
      if (error instanceof EditorialError) throw error;
      throw new EditorialError(
        "editorial_generation_failed",
        "Editorial recovery failed",
        502,
      );
    }

    try {
      const repairs = parseRecoveryModelOutput(recoveryRaw);
      const next = [...transmissions];
      for (const r of repairs) {
        if (r.index < 0 || r.index >= next.length) continue;
        const forcedMode = orderedModeSlots()[r.index]!;
        next[r.index] = {
          ...r.draft,
          mode: forcedMode,
          category: categoryForMode(forcedMode),
        };
      }
      transmissions = forceSlotModes(next);
    } catch {
      throw new EditorialError(
        "editorial_generation_failed",
        "Editorial recovery could not be parsed",
        502,
      );
    }

    // After one recovery: structural must pass; remaining soft quality is accepted.
    validateEditorialPackageStructure(transmissions, input.pack.world);
  } else {
    validateEditorialPackageStructure(transmissions, input.pack.world);
  }

  // Prevent accidental second recovery: quality re-assess not looped.
  assessment = assessEditorialPackage(transmissions, input.pack.world);
  if (assessment.structuralErrors.length > 0) {
    throw new EditorialError(
      "editorial_validation_failed",
      assessment.structuralErrors[0]!,
      422,
    );
  }

  return {
    brief: { ...input.brief, recoveryUsed },
    transmissions,
    recoveryUsed,
  };
}

/**
 * Regenerate one transmission; keep mode, avoid prior bodies.
 */
export async function generateEditorialSingle(input: {
  mode: EditorialMode;
  pack: EditorialContextPack;
  brief: EditorialBrief;
  avoidBodies: string[];
  caller?: EditorialModelCaller;
}): Promise<EditorialDraftTransmission> {
  const caller = input.caller ?? defaultCaller;
  let raw: unknown;
  try {
    raw = await caller({
      model: EDITORIAL_OPENAI_MODEL,
      system: buildEditorialRegenerateSystemPrompt(),
      user: buildEditorialRegenerateUserPayload({
        mode: input.mode,
        pack: input.pack,
        brief: input.brief,
        avoidBodies: input.avoidBodies,
      }),
      maxCompletionTokens: EDITORIAL_SINGLE_MAX_COMPLETION_TOKENS,
      mode: "single",
    });
  } catch (error) {
    if (error instanceof EditorialError) throw error;
    throw new EditorialError(
      "editorial_generation_failed",
      "Transmission regeneration failed",
      502,
    );
  }

  let draft: EditorialDraftTransmission;
  try {
    draft = parseSingleModelOutput(raw);
  } catch {
    throw new EditorialError(
      "editorial_generation_failed",
      "Regenerated transmission could not be parsed",
      502,
    );
  }

  draft = {
    ...draft,
    mode: input.mode,
    category: categoryForMode(input.mode),
  };
  validateSingleTransmission(
    draft,
    input.mode,
    input.pack.world,
    input.avoidBodies,
  );
  return draft;
}
