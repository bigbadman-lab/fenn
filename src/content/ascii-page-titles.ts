/**
 * Shared inner-page block-letter marks.
 * Same visual family as the Stage 5 CAMP wordmark.
 * 5-row glyphs; compose with renderAsciiMark().
 */

type Glyph = readonly [string, string, string, string, string];

/** Pad every row of a glyph to the glyph's max width. */
function normalizeGlyph(rows: Glyph): Glyph {
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => row.padEnd(width, " ")) as unknown as Glyph;
}

const RAW: Record<string, Glyph> = {
  A: [
    "  _  ",
    " / \\ ",
    "/ _ \\",
    "/ ___\\",
    "/_/  \\",
  ],
  B: [
    " ____ ",
    "| __ )",
    "|  _ \\",
    "| |_) |",
    "|____/",
  ],
  C: [
    "  ____",
    " / ___|",
    "| |    ",
    "| |___ ",
    " \\____|",
  ],
  D: [
    " ____ ",
    "|  _ \\",
    "| | | |",
    "| |_| |",
    "|____/",
  ],
  E: [
    " _____",
    "| ____|",
    "|  _|  ",
    "| |___ ",
    "|_____|",
  ],
  F: [
    " _____",
    "|  ___|",
    "| |_   ",
    "|  _|  ",
    "|_|    ",
  ],
  G: [
    "  ____ ",
    " / ___|",
    "| |  _ ",
    "| |_| |",
    " \\____|",
  ],
  H: [
    " _   _ ",
    "| | | |",
    "| |_| |",
    "|  _  |",
    "|_| |_|",
  ],
  I: [
    " ___ ",
    "|_ _|",
    " | | ",
    " | | ",
    "|___|",
  ],
  K: [
    " _  __",
    "| |/ /",
    "| ' / ",
    "| . \\ ",
    "|_|\\_\\",
  ],
  L: [
    " _    ",
    "| |   ",
    "| |   ",
    "| |___",
    "|_____|",
  ],
  M: [
    " __  __ ",
    "|  \\/  |",
    "| |\\/| |",
    "| |  | |",
    "|_|  |_|",
  ],
  N: [
    " _   _ ",
    "| \\ | |",
    "|  \\| |",
    "| |\\  |",
    "|_| \\_|",
  ],
  O: [
    "  ___  ",
    " / _ \\ ",
    "| | | |",
    "| |_| |",
    " \\___/ ",
  ],
  P: [
    " ____ ",
    "|  _ \\",
    "| |_) |",
    "|  __/",
    "|_|   ",
  ],
  R: [
    " ____ ",
    "|  _ \\",
    "| |_) |",
    "|  _ < ",
    "|_| \\_\\",
  ],
  S: [
    " ____ ",
    "/ ___|",
    "\\___ \\",
    " ___) |",
    "|____/ ",
  ],
  T: [
    " _____ ",
    "|_   _|",
    "  | |  ",
    "  | |  ",
    "  |_|  ",
  ],
  U: [
    " _   _ ",
    "| | | |",
    "| | | |",
    "| |_| |",
    " \\___/ ",
  ],
  W: [
    "__        __",
    "\\ \\  /\\  / /",
    " \\ \\/  \\/ / ",
    "  \\  /\\  /  ",
    "   \\/  \\/   ",
  ],
  Y: [
    " _   _ ",
    "| | | |",
    "| |_| |",
    " \\   / ",
    "  |_|  ",
  ],
};

/** Exact CAMP wordmark — do not regenerate (visual lock). */
export const CAMP_ASCII_MARK = `
  ____    _    __  __  ____
 / ___|  / \\  |  \\/  ||  _ \\
| |     / _ \\ | |\\/| || |_) |
| |___ / ___ \\| |  | ||  __/
 \\____/_/   \\_\\_|  |_||_|
`.replace(/^\n/, "").replace(/\n$/, "");

const GLYPHS: Record<string, Glyph> = Object.fromEntries(
  Object.entries(RAW).map(([key, glyph]) => [key, normalizeGlyph(glyph)]),
);

const GAP = "  ";
const WORD_GAP = "    ";

/**
 * Render a mark string (A–Z + spaces) into 5-row block ASCII.
 * Unknown characters are skipped.
 */
export function renderAsciiMark(text: string): string {
  const words = text
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[^A-Z]/g, ""));

  if (words.length === 0) return "";

  const wordGlyphRows = words.map((word) => {
    const letters = word
      .split("")
      .map((ch) => GLYPHS[ch])
      .filter(Boolean) as Glyph[];

    if (letters.length === 0) {
      return ["", "", "", "", ""] as unknown as Glyph;
    }

    return [0, 1, 2, 3, 4].map((row) =>
      letters.map((glyph) => glyph[row]).join(GAP),
    ) as unknown as Glyph;
  });

  return [0, 1, 2, 3, 4]
    .map((row) => wordGlyphRows.map((word) => word[row]).join(WORD_GAP))
    .join("\n");
}

/** Known page marks — prefer these for stable visual identity. */
export const PAGE_ASCII_MARKS = {
  CAMP: CAMP_ASCII_MARK,
  DEEDS: renderAsciiMark("DEEDS"),
  GREENWOOD: renderAsciiMark("GREENWOOD"),
  BOOK: renderAsciiMark("BOOK"),
  COMMONS: renderAsciiMark("COMMONS"),
  LEDGER: renderAsciiMark("LEDGER"),
  OAK: renderAsciiMark("OAK"),
  OUTLAW: renderAsciiMark("OUTLAW"),
  REGISTER: renderAsciiMark("REGISTER"),
} as const;

export type PageAsciiMarkKey = keyof typeof PAGE_ASCII_MARKS;

/**
 * Stable ASCII title accents — one deliberate colour per world surface.
 * Register shares `outlaw` so identity surfaces stay connected.
 */
export type AsciiTitleAccent =
  | "camp"
  | "deeds"
  | "greenwood"
  | "book"
  | "commons"
  | "ledger"
  | "oak"
  | "outlaw";
