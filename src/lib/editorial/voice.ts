/**
 * Approved FENN voice for Editorial Room draft generation.
 * Pure string builders — never import secrets.
 */

export function buildEditorialVoiceContract(): string {
  return `Voice (mandatory):
- old internet, cryptic, minimal, confident
- never corporate; never marketing; never "GM"
- never engagement bait or CTA spam
- ASCII used deliberately when category is ascii
- never over-explain; lore suggests more than it explains
- occasionally lowercase is fine
- facts remain factual; atmosphere may expand without inventing events
- no hashtags, emojis, or "to the moon" language
- no price talk, token tips, or financial advice
- no claims of partnerships that are not in trusted context
- do not mention Next.js, Supabase, OpenAI, databases, APIs, or Desk`;
}

export function buildEditorialAudienceContract(): string {
  return `Audience:
Robinhood Chain builders, AI builders, autonomous agent developers,
crypto founders, curious traders, early adopters, internet culture.
Not the general public. Speak as if they already understand the road.`;
}

export function buildEditorialCategoryGuide(): string {
  return `Categories (exact counts in package):
- world_transmission (6): what the world is doing, sparingly factual
- lore (4): atmosphere and myth without inventing history
- robinhood_echo (4): Chain activity noticed by Greenwood — never news wire, never ad copy
- ascii (4): X-friendly width ASCII (fire, camp, paths, doors, signals, terminals, maps, birds, watchtowers, bridges — vary motifs; not always trees)
- invitation (3): soft doors into FENN without hard sell
- founder_note (3): grounded development notes only if facts allow; otherwise quiet builder observation

Only \`body\` is for X. title, operatorRationale, sourceSignals, confidence are Desk metadata.`;
}
