import {
  EDITORIAL_PACKAGE_SIZE,
  orderedModeSlots,
  type EditorialMode,
} from "@/lib/editorial/categories";
import {
  buildEditorialAudienceContract,
  buildEditorialLaw,
  buildEditorialModeGuide,
  buildEditorialModeRegenNote,
  buildEditorialVoiceContract,
} from "@/lib/editorial/voice";
import type {
  EditorialBrief,
  EditorialContextPack,
  EditorialRobinhoodContext,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import { worldContextFactCatalog } from "@/lib/editorial/world-context";
import {
  BOOK_OF_SPEECH_VERSION,
  buildBookOfSpeechCanonBlock,
  buildBookOfSpeechPrecedenceNote,
} from "@/lib/fenn-voice/book-of-speech";

export function buildEditorialPackageSystemPrompt(): string {
  return `You are the Editorial hand of FENN.

You are preparing a day's transmissions from inside a living place.
Nothing is posted automatically. These are drafts for a Keeper at the Desk.

You have been given:
1. THE BOOK OF SPEECH (${BOOK_OF_SPEECH_VERSION})
2. today's newsroom
3. current world state
4. protected facts
5. recent FENN writing
6. the Keeper's current intent (if any)

Your task is not to advertise FENN.
Your task is to decide what FENN should say today — including what must stay strange.

FENN already knows what happened. It has not forgotten that something was living in the wood before the reader arrived.

${buildBookOfSpeechPrecedenceNote()}

${buildBookOfSpeechCanonBlock()}

${buildEditorialAudienceContract()}

${buildEditorialVoiceContract()}

${buildEditorialLaw()}

${buildEditorialModeGuide()}

Hard rules:
- Exactly ${EDITORIAL_PACKAGE_SIZE} transmissions.
- Return transmissions in the exact mode order given in the user payload slots array.
- Set mode exactly as assigned on each slot.
- grounded must be true or false (required boolean).
- No exact-duplicate bodies. No near-duplicate openings or ideas.
- CURRENT may only state supported recent/current facts.
- WORLD / LORE / ASCII / WILD must not invent current factual events; mythology and scenes are allowed when not misframed as news.
- protectedFacts and newsroom facts may be stated and poetically interpreted where appropriate to mode.
- You may NEVER alter, embellish, invent factual details, counts, dates, names, Deeds, Gatherings, LEAF awards, token/contract events, X interactions, people, launches, or feature claims not present in the trusted context.
- If the newsroom is quiet, CURRENT stays quiet; LORE / ASCII / WILD may still deepen the place.
- recentWriting is for anti-repetition only — do not restate those lines.
- WHAT MATTERS TODAY influences prioritisation across relevant modes; it does not turn the whole package into a campaign.
- sourceSignals must name keys from allowedSignalKeys only (never invent keys). Empty arrays are valid for LORE / ASCII / WILD.
- grounded=true only when the body draws on newsroom or protected facts.
- confidence reflects factual grounding (high = tightly tied to trusted facts); LORE/WILD may be medium/low.
- ASCII slots must be structural/visual. Do not deliver ordinary prose for mode=ascii.
- Do not "repair" intentional mystery into explanatory product copy in advance.

Output structured JSON only as specified.`;
}

export function buildEditorialPackageUserPayload(input: {
  pack: EditorialContextPack;
  brief: EditorialBrief;
}): string {
  const slots = orderedModeSlots();
  return JSON.stringify(
    {
      instruction:
        "Generate today's full editorial package. Use newsroom where modes require it; leave lore/ascii/wild free to deepen the world.",
      coveredDate: input.pack.coveredDate,
      generatedAt: input.pack.generatedAt,
      slots: slots.map((mode, index) => ({ index, mode })),
      NEWSROOM: {
        quiet: input.pack.newsroom.quiet,
        headlines: input.pack.newsroom.headlines,
        notableActivity: input.pack.newsroom.notableActivity,
      },
      WORLD_STATE: input.pack.worldState,
      PROTECTED_FACTS: input.pack.protectedFacts,
      RECENT_WRITING: input.pack.recentWriting,
      WHAT_MATTERS_TODAY: input.pack.editorialFocus.whatMattersToday,
      editorialNotes: {
        themes: input.brief.themes,
        avoid: input.brief.avoid,
      },
      dayCounts: worldContextFactCatalog(input.pack.world),
      robinhoodAwareness: {
        hasTrustedSignals: input.pack.robinhood.hasTrustedSignals,
        lines: input.pack.robinhood.lines,
        caution: input.pack.robinhood.caution,
      },
      allowedSignalKeys: input.pack.world.signalKeys,
    },
    null,
    2,
  );
}

export function buildEditorialRegenerateSystemPrompt(): string {
  return `You are regenerating ONE draft transmission for THE EDITORIAL ROOM in FENN.

${buildBookOfSpeechPrecedenceNote()}

${buildBookOfSpeechCanonBlock()}

${buildEditorialAudienceContract()}

${buildEditorialVoiceContract()}

${buildEditorialLaw()}

Hard rules:
- Keep the assigned mode exactly.
- Produce a different body from the avoided drafts provided.
- Do not invent current factual events outside NEWSROOM / PROTECTED_FACTS / dayCounts.
- WORLD / LORE may remain mysterious without newsroom grounding.
- ASCII must remain visual/terminal structure — never ordinary prose.
- WILD must remain genuinely strange, not mildly cryptic prose.
- sourceSignals must use allowedSignalKeys only (empty allowed for LORE/ASCII/WILD).
- Body only is for X; title and operatorRationale are operator metadata.
- grounded=true only when drawing on newsroom/protected facts.`;
}

export function buildEditorialRegenerateUserPayload(input: {
  mode: EditorialMode;
  pack: EditorialContextPack;
  brief: EditorialBrief;
  avoidBodies: string[];
}): string {
  return JSON.stringify(
    {
      instruction: "Regenerate a single transmission for this mode.",
      mode: input.mode,
      modeNote: buildEditorialModeRegenNote(input.mode),
      avoidBodies: input.avoidBodies.slice(0, 8),
      NEWSROOM: {
        quiet: input.pack.newsroom.quiet,
        headlines: input.pack.newsroom.headlines,
        notableActivity: input.pack.newsroom.notableActivity,
      },
      WORLD_STATE: input.pack.worldState,
      PROTECTED_FACTS: input.pack.protectedFacts,
      RECENT_WRITING: input.pack.recentWriting,
      WHAT_MATTERS_TODAY: input.pack.editorialFocus.whatMattersToday,
      editorialNotes: {
        themes: input.brief.themes,
        avoid: input.brief.avoid,
      },
      dayCounts: worldContextFactCatalog(input.pack.world),
      robinhoodAwareness: {
        hasTrustedSignals: input.pack.robinhood.hasTrustedSignals,
        lines: input.pack.robinhood.lines,
        caution: input.pack.robinhood.caution,
      },
      allowedSignalKeys: input.pack.world.signalKeys,
    },
    null,
    2,
  );
}

export function buildEditorialRecoverySystemPrompt(): string {
  return `You are repairing specific draft transmissions for THE EDITORIAL ROOM in FENN.

Do not rejudge the overall strategy.
Repair only the listed transmissions.

${buildBookOfSpeechPrecedenceNote()}

${buildBookOfSpeechCanonBlock()}

${buildEditorialLaw()}

Hard rules:
- Keep each assigned mode.
- Fix the listed failure reasons only.
- Do NOT convert intentional mystery, lore, or strange structure into generic explanatory product copy.
- If mode is ascii, the repair MUST remain visual/terminal structure (not prose).
- If mode is world_lore, the repair may stay mysterious; do not invent current facts.
- If mode is wild, keep genuine strangeness.
- Differ from neighbouring transmissions and avoided near-duplicates.
- Do not invent facts outside trusted context.
- sourceSignals ⊆ allowedSignalKeys (empty ok for LORE/ASCII/WILD).
- grounded only when drawing on newsroom/protected facts.`;
}

export function buildEditorialRecoveryUserPayload(input: {
  pack: EditorialContextPack;
  brief: EditorialBrief;
  failures: Array<{
    index: number;
    mode: EditorialMode;
    body: string;
    reasons: string[];
  }>;
  neighbourBodies: string[];
}): string {
  return JSON.stringify(
    {
      instruction:
        "Repair only these transmissions. Do not rewrite the whole package strategy. Do not sand mystery into marketing.",
      failures: input.failures.map((f) => ({
        ...f,
        modeNote: buildEditorialModeRegenNote(f.mode),
      })),
      neighbourBodies: input.neighbourBodies.slice(0, EDITORIAL_PACKAGE_SIZE),
      NEWSROOM: {
        quiet: input.pack.newsroom.quiet,
        headlines: input.pack.newsroom.headlines,
      },
      PROTECTED_FACTS: input.pack.protectedFacts,
      RECENT_WRITING: input.pack.recentWriting,
      WHAT_MATTERS_TODAY: input.pack.editorialFocus.whatMattersToday,
      dayCounts: worldContextFactCatalog(input.pack.world),
      allowedSignalKeys: input.pack.world.signalKeys,
    },
    null,
    2,
  );
}

/** @deprecated legacy signature helpers for tests that only pass world/brief */
export function buildEditorialPackageUserPayloadLegacy(input: {
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
  brief: EditorialBrief;
}): string {
  return JSON.stringify({
    coveredDate: input.world.coveredDate,
    slots: orderedModeSlots().map((mode, index) => ({ index, mode })),
    editorialBrief: input.brief,
    worldFacts: worldContextFactCatalog(input.world),
    robinhoodAwareness: input.robinhood,
    allowedSignalKeys: input.world.signalKeys,
  });
}
