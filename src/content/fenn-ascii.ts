/**
 * Canonical FENN character ASCII — one source for welcome + map variants.
 * Monospace-native; not an image asset.
 */

/** Full detailed FENN — welcome / proclamation scale. */
export const FENN_ASCII_DETAILED = `
          /---\\
         /     \\  /--/
        /       \\/  /
       /--------\\--/
      /          \\
     |  o     o   |
      \\    v     /
       \\   |    /
        \\--|---/
        /  |  \\
       /   |   \\
      /    |    \\
     /     |     \\
    (_) v e l l (_)
       /-----\\
        /   \\
       (_) (_)
`.replace(/^\n/, "").replace(/\n$/, "");

/**
 * Map-scale FENN — same character, slightly tighter for overlay.
 * Pose A (standing / left foot forward).
 */
export const FENN_ASCII_MAP_A = `
      /---\\
     /     \\ /-/
    /-------\\-/
   | o   o  |
    \\  v  /
     \\-|-/
    /  |  \\
   (_)vell(_)
     /---\\
     (_)(_)
`.replace(/^\n/, "").replace(/\n$/, "");

/** Map pose B — alternate feet for walking. */
export const FENN_ASCII_MAP_B = `
      /---\\
     /     \\ /-/
    /-------\\-/
   | o   o  |
    \\  v  /
     \\-|-/
    /  |  \\
   (_)vell(_)
     /---\\
    (_) (_)
`.replace(/^\n/, "").replace(/\n$/, "");

/**
 * Compact mobile map FENN — recognisable hat/eyes/cloak/legs,
 * small enough for the 78-col strip.
 */
export const FENN_ASCII_MAP_COMPACT_A = `
  /---\\
 / o o \\
  \\-|-/
 /  |  \\
(_)vell(_)
  (_)(_)
`.replace(/^\n/, "").replace(/\n$/, "");

export const FENN_ASCII_MAP_COMPACT_B = `
  /---\\
 / o o \\
  \\-|-/
 /  |  \\
(_)vell(_)
 (_) (_)
`.replace(/^\n/, "").replace(/\n$/, "");

export type FennAsciiPose = "a" | "b";

export function fennMapAscii(
  variant: "desktop" | "mobile",
  pose: FennAsciiPose,
): string {
  if (variant === "mobile") {
    return pose === "a" ? FENN_ASCII_MAP_COMPACT_A : FENN_ASCII_MAP_COMPACT_B;
  }
  return pose === "a" ? FENN_ASCII_MAP_A : FENN_ASCII_MAP_B;
}
