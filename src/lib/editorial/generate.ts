import "server-only";

import { zodResponseFormat } from "openai/helpers/zod";

import { EditorialError } from "@/lib/editorial/errors";
import {
  buildEditorialPackageSystemPrompt,
  buildEditorialPackageUserPayload,
  buildEditorialRegenerateSystemPrompt,
  buildEditorialRegenerateUserPayload,
} from "@/lib/editorial/generate-prompt";
import {
  assertNoAuthorityFields,
  editorialPackageModelSchema,
  editorialSingleModelSchema,
  parsePackageModelOutput,
  parseSingleModelOutput,
} from "@/lib/editorial/generate-schema";
import type { EditorialCategory } from "@/lib/editorial/categories";
import {
  EDITORIAL_OPENAI_MODEL,
  EDITORIAL_PACKAGE_MAX_COMPLETION_TOKENS,
  EDITORIAL_SINGLE_MAX_COMPLETION_TOKENS,
} from "@/lib/editorial/types";
import {
  validateEditorialPackage,
  validateSingleTransmission,
} from "@/lib/editorial/validate";
import type {
  EditorialBrief,
  EditorialDraftTransmission,
  EditorialGeneratedPackage,
  EditorialRobinhoodContext,
  EditorialWorldContext,
} from "@/lib/editorial/types";

export type EditorialModelCaller = (args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
  mode: "package" | "single";
}) => Promise<unknown>;

async function defaultCaller(args: {
  model: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
  mode: "package" | "single";
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

  const completion = await client.chat.completions.parse({
    model: args.model,
    max_completion_tokens: args.maxCompletionTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    response_format: zodResponseFormat(
      args.mode === "package"
        ? editorialPackageModelSchema
        : editorialSingleModelSchema,
      args.mode === "package"
        ? "fenn_editorial_package"
        : "fenn_editorial_transmission",
    ),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new EditorialError(
      "editorial_generation_failed",
      "Model returned no structured editorial output",
      502,
    );
  }
  assertNoAuthorityFields(parsed);
  return parsed;
}

/**
 * Single structured model call → full 24-transmission package.
 */
export async function generateEditorialPackage(input: {
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
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
        world: input.world,
        robinhood: input.robinhood,
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
  } catch {
    throw new EditorialError(
      "editorial_generation_failed",
      "Editorial package could not be parsed",
      502,
    );
  }

  validateEditorialPackage(transmissions, input.world);

  return {
    brief: input.brief,
    transmissions,
  };
}

/**
 * Regenerate one transmission; keep category, avoid prior bodies.
 */
export async function generateEditorialSingle(input: {
  category: EditorialCategory;
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
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
        category: input.category,
        world: input.world,
        robinhood: input.robinhood,
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

  // Force category from request.
  draft = { ...draft, category: input.category };
  validateSingleTransmission(
    draft,
    input.category,
    input.world,
    input.avoidBodies,
  );
  return draft;
}
