/**
 * FENN homepage world map — wide landscape ASCII with navigable landmarks.
 * Lines are fixed-width; colour is deterministic per character (no Math.random).
 */

export type MapTone =
  | "bone"
  | "mute"
  | "mountain"
  | "forest"
  | "forest-mid"
  | "forest-deep"
  | "leaf"
  | "path"
  | "hoard"
  | "water"
  | "gate"
  | "camp"
  | "oak"
  | "book"
  | "ledger"
  | "deeds"
  | "commons"
  | "here"
  | "label";

export type MapFrag = {
  t: string;
  c?: MapTone;
  href?: string;
};

export type MapRow = readonly MapFrag[];

type MapLink = {
  label: string;
  href: string;
  c: MapTone;
};

const DESKTOP_WIDTH = 116;
const MOBILE_WIDTH = 78;

function fit(line: string, width = DESKTOP_WIDTH): string {
  if (line.length >= width) return line.slice(0, width);
  return line + " ".repeat(width - line.length);
}

function place(left: string, mid: string, right: string, width = DESKTOP_WIDTH): string {
  const room = width - left.length - right.length;
  if (room < 0) return (left + right).slice(0, width);
  const clipped = mid.length > room ? mid.slice(0, room) : mid;
  const pad = room - clipped.length;
  const leftPad = Math.floor(pad / 2);
  const rightPad = pad - leftPad;
  return left + " ".repeat(leftPad) + clipped + " ".repeat(rightPad) + right;
}

/** Deterministic terrain tone from character + column (stable, irregular-looking). */
function toneAt(ch: string, col: number): MapTone {
  if (ch === " ") return "mute";
  if (ch === "~") return "water";
  if (ch === "^") {
    const lane = col % 5;
    if (lane === 0) return "forest-deep";
    if (lane === 1 || lane === 2) return "forest-mid";
    return "forest";
  }
  if (ch === "Y") return col % 3 === 0 ? "leaf" : "forest";
  if (ch === ".") return col % 4 === 0 ? "hoard" : "path";
  if (ch === "-" || ch === "+") return "path";
  if (ch === "/" || ch === "\\") return "mountain";
  if (ch === "|" || ch === "[" || ch === "]") return "gate";
  if (ch === "*" ) return "leaf";
  if (ch === "X") return "here";
  if (ch === "#" || ch === "=") return "deeds";
  if (ch === "{" || ch === "}") return "commons";
  if (ch === "(" || ch === ")") return "camp";
  // prose / labels
  if (/[a-zA-Z]/.test(ch)) return "label";
  return "bone";
}

function paintTerrain(segment: string, colOffset: number): MapFrag[] {
  if (!segment) return [];
  const frags: MapFrag[] = [];
  let start = 0;
  let current = toneAt(segment[0]!, colOffset);

  for (let i = 1; i <= segment.length; i += 1) {
    const next =
      i < segment.length ? toneAt(segment[i]!, colOffset + i) : null;
    if (next !== current) {
      frags.push({ t: segment.slice(start, i), c: current });
      if (next == null) break;
      start = i;
      current = next;
    }
  }
  return frags;
}

function buildRows(
  lines: string[],
  links: readonly MapLink[],
  width?: number,
): MapRow[] {
  return lines.map((raw) => {
    const line =
      raw.length === 0 ? "" : width != null ? fit(raw, width) : raw;
    if (!line) return [{ t: "", c: "mute" }] as const;

    type Cut = { start: number; end: number; link: MapLink };
    const cuts: Cut[] = [];
    for (const link of links) {
      let from = 0;
      while (from < line.length) {
        const idx = line.indexOf(link.label, from);
        if (idx < 0) break;
        cuts.push({ start: idx, end: idx + link.label.length, link });
        from = idx + link.label.length;
      }
    }
    cuts.sort((a, b) => a.start - b.start);

    const frags: MapFrag[] = [];
    let cursor = 0;
    for (const cut of cuts) {
      if (cut.start < cursor) continue;
      if (cut.start > cursor) {
        frags.push(...paintTerrain(line.slice(cursor, cut.start), cursor));
      }
      frags.push({ t: cut.link.label, c: cut.link.c, href: cut.link.href });
      cursor = cut.end;
    }
    if (cursor < line.length) {
      frags.push(...paintTerrain(line.slice(cursor), cursor));
    }
    return frags;
  });
}

const DESKTOP_LINKS: readonly MapLink[] = [
  { label: "[ the book ]", href: "/book", c: "book" },
  { label: "[ the oak ]", href: "/oak", c: "oak" },
  {
    label: "[ the greenwood ]",
    href: "/greenwood?crossing=1",
    c: "leaf",
  },
  { label: "[ deeds ]", href: "/deeds", c: "deeds" },
  { label: "[ the camp ]", href: "/camp", c: "camp" },
  { label: "[ the ledger ]", href: "/ledger", c: "ledger" },
  { label: "[ the commons ]", href: "/commons", c: "commons" },
];

const DESKTOP_LINES: string[] = [
  place(
    "            /\\   /\\/\\     /\\",
    "/\\/\\            /\\",
    "/\\    /\\/\\   /\\      /\\",
  ),
  place(
    "         /\\/\\  /\\/\\__/\\/\\",
    "/\\/\\         /\\/\\__/\\",
    "/\\/\\  /\\/\\__/\\/\\   /\\/\\",
  ),
  place(
    "        /    \\/      \\",
    "/  \\        /    \\",
    "/    \\    \\    \\  /  \\",
  ),
  fit(
    "         mountains . unknown . . . . . .              . . farther unknown territory . . . edge.",
  ),
  "",
  place("  [ the book ]", "", "[ the oak ]"),
  place("     [|=|]", "", "Y"),
  place("     ||||", "", "\\|||/"),
  place("  knowledge kept", "", "it was here"),
  place("  in the open.", "", "before you."),
  "",
  place(
    "      . . : : . .",
    "~~ ~~ ~~ ~~              ~~~~~~~~~~~~~~~~",
    "^^ Y ^^ Y ^^",
  ),
  place(
    "     : ^^^  ^^^  :",
    "~~~~~~~~~~~~~~~          ~              ~",
    "Y ^^ ^^ ^^ Y",
  ),
  place(
    "    .  ^^^  ^^^  .",
    "~               ~         ~~~~~~~~~~~~~~~~",
    "^^ Y ^^ Y ^^",
  ),
  place("          ...", "~~~~.~~~~                 ~~~.~~~", ". . ."),
  place("           .", ".", "."),
  fit(
    " ................   ..........   ..................   ..........   ................   ......",
  ),
  "",
  fit("                     ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^"),
  fit("                    Y Y ^^^ ^^^ [|||] ^^^ ^^^ Y Y ^^^ Y ^^^ ^^^"),
  fit("                   ^^^ Y ^^^ ^^ [|||] ^^ ^^^ Y ^^^ ^^^ ^^^ ^^^"),
  fit("                  ^^^ ^^^ ^^^ ^^[|||]^^ ^^^ ^^^ ^^^ ^^^ ^^^ ^^^"),
  fit("                            [ the greenwood ]"),
  fit("                          the wood remembers."),
  "",
  place(
    " [ deeds ] ........ woods ......../",
    "",
    "\\........ woods ........ [ the camp ]",
  ),
  place(
    "   [###]            .      .",
    "",
    ".      .                  ( * )",
  ),
  place("  notice.          ...............", "...............", "tents."),
  place("  work waits.", "", "the fire is low."),
  "",
  place("       [ the ledger ]", "\\    |    /", ". . ."),
  place("          |||||", "|", ": : :"),
  place("          |||||", "[ the commons ]", ""),
  place("       what moved", "{ ~~~ }", ""),
  place("       remains.", "what may move.", ""),
  "",
  fit("                                                     X"),
  fit("                                                you are here."),
];

const MOBILE_LINKS: readonly MapLink[] = DESKTOP_LINKS;

/**
 * Mobile landscape — ~78 columns.
 * Outer world / "you are here" sits in the left third so native
 * scroll starts outside the Greenwood without JS positioning.
 */
const MOBILE_LINES: string[] = [
  place(
    " X you are here.",
    "~~ ~~",
    "[ the book ]   [ the oak ]",
    MOBILE_WIDTH,
  ),
  place(" .", "~~~~", "[|=|]         Y", MOBILE_WIDTH),
  place(" ..", "~  ~", "||||       \\|||/", MOBILE_WIDTH),
  place("  ...", ".", "", MOBILE_WIDTH),
  "",
  place(
    "[ deeds ]....woods....",
    "^^^ ^^^ ^^^",
    "....woods....[ the camp ]",
    MOBILE_WIDTH,
  ),
  place(
    " [#]        ..",
    "Y ^^[|||]^^ Y",
    "..       ( * )",
    MOBILE_WIDTH,
  ),
  place(
    "[ the ledger ].......",
    "^^^ [|||] ^^^",
    ".................",
    MOBILE_WIDTH,
  ),
  place("  |||||", "\\", "[ the greenwood ]", MOBILE_WIDTH),
  place(
    "[ the commons ]{~~~}",
    "--/",
    "the wood remembers.",
    MOBILE_WIDTH,
  ),
  place("  { ~ }", "/", "", MOBILE_WIDTH),
  "",
  fit(" . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .", MOBILE_WIDTH),
];

export const FENN_WORLD_MAP_DESKTOP: readonly MapRow[] = buildRows(
  DESKTOP_LINES,
  DESKTOP_LINKS,
  DESKTOP_WIDTH,
);

export const FENN_WORLD_MAP_MOBILE: readonly MapRow[] = buildRows(
  MOBILE_LINES,
  MOBILE_LINKS,
  MOBILE_WIDTH,
);

/** Approximate desktop monospace column count. */
export const FENN_WORLD_MAP_DESKTOP_WIDTH = DESKTOP_WIDTH;

/** Approximate mobile monospace column count. */
export const FENN_WORLD_MAP_MOBILE_WIDTH = MOBILE_WIDTH;
