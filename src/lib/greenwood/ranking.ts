export type GreenwoodStandingRow = {
  profileId: string;
  outlawNumber: number;
  leafLifetimeEarned: number;
};

export function computeGreenwoodStandingRank(input: {
  profileId: string;
  members: GreenwoodStandingRow[];
}): { rank: number; total: number } {
  const total = input.members.length;
  if (total === 0) {
    throw new Error("computeGreenwoodStandingRank: no Greenwood members");
  }

  const sorted = [...input.members].sort((a, b) => {
    // Highest lifetime LEAF comes first.
    if (a.leafLifetimeEarned !== b.leafLifetimeEarned) {
      return b.leafLifetimeEarned - a.leafLifetimeEarned;
    }
    // Deterministic tie ordering.
    if (a.outlawNumber !== b.outlawNumber) {
      return a.outlawNumber - b.outlawNumber;
    }
    return a.profileId.localeCompare(b.profileId);
  });

  const idx = sorted.findIndex((m) => m.profileId === input.profileId);
  if (idx < 0) {
    throw new Error("computeGreenwoodStandingRank: profile not found");
  }

  return { rank: idx + 1, total };
}

/**
 * Display helper. This is not a named tier system; it is just formatting
 * of a numeric rank for the UI.
 */
export function toRomanNumeral(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return "?";
  if (n >= 4000) return String(n);

  const numerals: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let remaining = n;
  let out = "";
  for (const [value, glyph] of numerals) {
    while (remaining >= value) {
      out += glyph;
      remaining -= value;
    }
  }
  return out;
}

