import {
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  orderedCategorySlots,
  type EditorialCategory,
} from "@/lib/editorial/categories";
import {
  buildEditorialAudienceContract,
  buildEditorialCategoryGuide,
  buildEditorialVoiceContract,
} from "@/lib/editorial/voice";
import type {
  EditorialBrief,
  EditorialRobinhoodContext,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import { worldContextFactCatalog } from "@/lib/editorial/world-context";

export function buildEditorialPackageSystemPrompt(): string {
  return `You are preparing a day's draft transmissions for THE EDITORIAL ROOM inside FENN.

This is an operator tool. You produce drafts for review. Nothing is posted automatically.

${buildEditorialAudienceContract()}

${buildEditorialVoiceContract()}

${buildEditorialCategoryGuide()}

Hard rules:
- Exactly ${EDITORIAL_PACKAGE_SIZE} transmissions.
- Exact category counts: world_transmission ${EDITORIAL_CATEGORY_QUOTAS.world_transmission}, lore ${EDITORIAL_CATEGORY_QUOTAS.lore}, robinhood_echo ${EDITORIAL_CATEGORY_QUOTAS.robinhood_echo}, ascii ${EDITORIAL_CATEGORY_QUOTAS.ascii}, invitation ${EDITORIAL_CATEGORY_QUOTAS.invitation}, founder_note ${EDITORIAL_CATEGORY_QUOTAS.founder_note}.
- Return transmissions in the exact category order given in the user payload slots array.
- No duplicate or near-duplicate bodies.
- No repeated first sentences across bodies.
- ASCII pieces must all differ.
- Do not invent statistics, admissions, Deeds, Outlaw counts, Gatherings, or FENN actions not in trusted context.
- If the day is quiet, stay quiet. Do not invent busyness.
- Robinhood echoes connect chain atmosphere to Greenwood without sounding like news or ads.
- sourceSignals must name keys from allowedSignalKeys only.
- confidence reflects how tightly the draft is grounded (high = tightly tied to facts).

Output structured JSON only as specified.`;
}

export function buildEditorialPackageUserPayload(input: {
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
  brief: EditorialBrief;
}): string {
  const slots = orderedCategorySlots();
  return JSON.stringify(
    {
      instruction:
        "Generate today's full editorial package from trusted context only.",
      coveredDate: input.world.coveredDate,
      slots: slots.map((category, index) => ({ index, category })),
      editorialBrief: input.brief,
      worldFacts: worldContextFactCatalog(input.world),
      robinhoodAwareness: {
        hasTrustedSignals: input.robinhood.hasTrustedSignals,
        lines: input.robinhood.lines,
        caution: input.robinhood.caution,
      },
      allowedSignalKeys: input.world.signalKeys,
    },
    null,
    2,
  );
}

export function buildEditorialRegenerateSystemPrompt(): string {
  return `You are regenerating ONE draft transmission for THE EDITORIAL ROOM in FENN.

${buildEditorialAudienceContract()}

${buildEditorialVoiceContract()}

Hard rules:
- Keep the assigned category.
- Produce a different body from the avoided drafts provided.
- Do not invent facts outside trusted context.
- sourceSignals must use allowedSignalKeys only.
- Body only is for X; title and operatorRationale are operator metadata.`;
}

export function buildEditorialRegenerateUserPayload(input: {
  category: EditorialCategory;
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
  brief: EditorialBrief;
  avoidBodies: string[];
}): string {
  return JSON.stringify(
    {
      instruction: "Regenerate a single transmission for this category.",
      category: input.category,
      avoidBodies: input.avoidBodies.slice(0, 8),
      editorialBrief: input.brief,
      worldFacts: worldContextFactCatalog(input.world),
      robinhoodAwareness: {
        hasTrustedSignals: input.robinhood.hasTrustedSignals,
        lines: input.robinhood.lines,
        caution: input.robinhood.caution,
      },
      allowedSignalKeys: input.world.signalKeys,
    },
    null,
    2,
  );
}
