/**
 * AT THE FIRE — static ASCII woodland clearing scenes.
 * Waiting vs seated states only. No frame animation.
 */

export type FireAsciiTone = "bone" | "ash" | "ember" | "greenwood";

export type FireAsciiLine = {
  text: string;
  tone?: FireAsciiTone;
};

/** Desktop waiting: quiet night clearing with a small living fire. (~68 cols) */
export const GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP: FireAsciiLine[] = [
  {
    text: "     .              .        *              .            .",
    tone: "ash",
  },
  {
    text: "         /\\                                  /\\",
    tone: "greenwood",
  },
  {
    text: "        /**\\      .             .           /**\\      /\\",
    tone: "greenwood",
  },
  {
    text: "       /****\\                              /****\\    /**\\",
    tone: "greenwood",
  },
  {
    text: "      /******/      .       .              /******/  /****\\",
    tone: "greenwood",
  },
  {
    text: "         ||                                  ||        ||",
    tone: "ash",
  },
  {
    text: "   /\\    ||            .   |   .             ||",
    tone: "greenwood",
  },
  {
    text: "  /**\\                   \\  |  /                o",
    tone: "ember",
  },
  { text: " /****\\                   \\ | /", tone: "ember" },
  { text: "   ||                      \\|/", tone: "ember" },
  { text: "   ||                      ( )", tone: "ember" },
  { text: "                            ^", tone: "ember" },
  { text: "                        .  /_\\  .", tone: "bone" },
  { text: "                       ___/___\\___", tone: "bone" },
  { text: "                      /  o     o  \\", tone: "ash" },
  { text: "                     (_____________)", tone: "ash" },
  {
    text: "           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    tone: "ash",
  },
];

/** Desktop seated: same clearing; fire fuller and warmer. */
export const GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP: FireAsciiLine[] = [
  {
    text: "     .       *      .        *        .      *     .",
    tone: "ash",
  },
  {
    text: "         /\\          .                  .    /\\",
    tone: "greenwood",
  },
  {
    text: "        /**\\    .      *    *     .          /**\\      /\\",
    tone: "greenwood",
  },
  {
    text: "       /****\\                              /****\\    /**\\",
    tone: "greenwood",
  },
  {
    text: "      /******/      .  . * .  .             /******/  /****\\",
    tone: "greenwood",
  },
  {
    text: "         ||                                  ||        ||",
    tone: "ash",
  },
  {
    text: "   /\\    ||         .  \\  |  /  .             ||",
    tone: "greenwood",
  },
  {
    text: "  /**\\                  \\ | /              *   o",
    tone: "ember",
  },
  { text: " /****\\              \\   \\|/   /", tone: "ember" },
  { text: "   ||                 \\  ( )  /", tone: "ember" },
  { text: "   ||                  \\ )*( /", tone: "ember" },
  { text: "                         /_\\", tone: "bone" },
  { text: "                     .  /___\\  .", tone: "bone" },
  { text: "                    ___/_____\\___", tone: "bone" },
  { text: "                   /  o  _|_  o  \\", tone: "ash" },
  { text: "                  (_______________)", tone: "ash" },
  {
    text: "           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    tone: "ash",
  },
];

/** Mobile waiting: compact clearing (~34 cols). */
export const GREENWOOD_FIRE_CLEARING_WAITING_MOBILE: FireAsciiLine[] = [
  { text: "   .        .      *", tone: "ash" },
  { text: "  /\\              /\\", tone: "greenwood" },
  { text: " /**\\    .       /**\\", tone: "greenwood" },
  { text: "  ||              ||", tone: "ash" },
  { text: "        \\ | /", tone: "ember" },
  { text: "         \\|/", tone: "ember" },
  { text: "         ( )", tone: "ember" },
  { text: "          ^", tone: "ember" },
  { text: "         /_\\", tone: "bone" },
  { text: "      __/___\\__", tone: "bone" },
  { text: "     (_________)", tone: "ash" },
];

/** Mobile seated: compact warmer fire. */
export const GREENWOOD_FIRE_CLEARING_SEATED_MOBILE: FireAsciiLine[] = [
  { text: "   .   *    .    *", tone: "ash" },
  { text: "  /\\    .       /\\", tone: "greenwood" },
  { text: " /**\\  * . *   /**\\", tone: "greenwood" },
  { text: "  ||    \\ | /   ||", tone: "ash" },
  { text: "         \\|/", tone: "ember" },
  { text: "       \\ ( ) /", tone: "ember" },
  { text: "        \\)*( /", tone: "ember" },
  { text: "         /_\\", tone: "bone" },
  { text: "      __/___\\__", tone: "bone" },
  { text: "     (_________)", tone: "ash" },
];

/** Subdued listening mark while the Fire is resolving. */
export const GREENWOOD_FIRE_CLEARING_LISTENING: FireAsciiLine[] = [
  { text: "      |", tone: "ember" },
  { text: "     ( )", tone: "ember" },
  { text: "      ^", tone: "ember" },
  { text: "     /_\\", tone: "bone" },
];

/**
 * Flatten line records to plain text (tests / pre-render).
 * Width of each frame is the max line length.
 */
export function fireAsciiToText(lines: readonly FireAsciiLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

export const GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP_TEXT = fireAsciiToText(
  GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP,
);
export const GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP_TEXT = fireAsciiToText(
  GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP,
);
export const GREENWOOD_FIRE_CLEARING_WAITING_MOBILE_TEXT = fireAsciiToText(
  GREENWOOD_FIRE_CLEARING_WAITING_MOBILE,
);
export const GREENWOOD_FIRE_CLEARING_SEATED_MOBILE_TEXT = fireAsciiToText(
  GREENWOOD_FIRE_CLEARING_SEATED_MOBILE,
);
export const GREENWOOD_FIRE_CLEARING_LISTENING_TEXT = fireAsciiToText(
  GREENWOOD_FIRE_CLEARING_LISTENING,
);

/** Compact title mark beside AT THE FIRE. */
export const GREENWOOD_FIRE_TITLE_MARK = "(^)";

/** Other waiting members shown around the Fire (excluding self). */
export const GREENWOOD_FIRE_CLEARING_WAITING_LIMIT = 4;
export const GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW = 2;

export const GREENWOOD_FIRE_A11Y_WAITING =
  "A quiet campfire in a Greenwood clearing.";

export const GREENWOOD_FIRE_A11Y_SEATED =
  "A brighter campfire with your place held among waiting members.";

export const GREENWOOD_FIRE_A11Y_LISTENING =
  "A small fire mark while the Greenwood listens.";

export function formatFireWaitingOverflow(count: number): string {
  if (count <= 0) return "";
  if (count === 1) {
    return "+ 1 OTHER MARK WAITS BEYOND THE FIRELIGHT";
  }
  return `+ ${count} OTHER MARKS WAIT BEYOND THE FIRELIGHT`;
}
