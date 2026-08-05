/**
 * Curated Traveller surname catalogue — server only assignment.
 * World-consistent wood words; no user-generated names.
 */
export const CLEARING_TRAVELLER_SURNAMES = [
  "Ash",
  "Moss",
  "Flint",
  "Rowan",
  "Fern",
  "Alder",
  "Stone",
  "Reed",
  "Thorn",
  "Birch",
  "Cedar",
  "Haze",
  "Mire",
  "Bracken",
  "Heath",
  "Clay",
  "Mist",
  "Glen",
  "Brook",
  "Pine",
  "Oak",
  "Yew",
  "Lark",
  "Wren",
  "Rook",
  "Hare",
  "Dove",
  "Vale",
  "Dale",
  "Ridge",
  "Creek",
  "Marsh",
  "Grove",
  "Holt",
  "Shade",
  "Ember",
  "Cinder",
  "Frost",
  "Thicket",
  "Willow",
] as const;

export type ClearingTravellerSurname =
  (typeof CLEARING_TRAVELLER_SURNAMES)[number];

export function formatTravellerDisplayName(surname: string): string {
  return `Traveller ${surname.trim()}`;
}

/** Cryptographically random surname from the catalogue. */
export function pickTravellerSurname(
  random: () => number = Math.random,
): ClearingTravellerSurname {
  const list = CLEARING_TRAVELLER_SURNAMES;
  const index = Math.floor(random() * list.length) % list.length;
  return list[index]!;
}

export function isCuratedTravellerDisplayName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed.startsWith("Traveller ")) return false;
  const surname = trimmed.slice("Traveller ".length);
  return (CLEARING_TRAVELLER_SURNAMES as readonly string[]).includes(surname);
}
