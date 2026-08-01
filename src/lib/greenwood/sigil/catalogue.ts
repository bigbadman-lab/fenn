/**
 * Living Greenwood 1 — curated ASCII sigil catalogue (application source).
 * Database rows seeded from this set remain the authority for assignments.
 *
 * Constraints:
 * - exactly 64 normal curated sigils + 1 reserved UNMARKED fallback
 * - 3–5 lines, width ≤ 16 monospace columns
 * - no letters/digits implying user identity
 * - primitive woodland marks
 */

export const GREENWOOD_SIGIL_MAX_WIDTH = 16;
export const GREENWOOD_SIGIL_MIN_HEIGHT = 3;
export const GREENWOOD_SIGIL_MAX_HEIGHT = 5;

/** Stable UUID for the reserved fallback mark. */
export const UNMARKED_SIGIL_ID = "a0000000-0000-4000-8000-000000000000";

export type GreenwoodSigilDefinition = {
  id: string;
  slug: string;
  asciiBody: string;
  a11yLabel: string;
  width: number;
  height: number;
  sortOrder: number;
  isFallback: boolean;
};

function measure(asciiBody: string): { width: number; height: number } {
  const lines = asciiBody.replace(/\n$/, "").split("\n");
  return {
    height: lines.length,
    width: lines.reduce((max, line) => Math.max(max, line.length), 0),
  };
}

function def(
  sortOrder: number,
  slug: string,
  asciiBody: string,
  a11yLabel: string,
  idSuffix: string,
  isFallback = false,
): GreenwoodSigilDefinition {
  const { width, height } = measure(asciiBody);
  return {
    id: `a0000000-0000-4000-8000-${idSuffix.padStart(12, "0")}`,
    slug,
    asciiBody,
    a11yLabel,
    width,
    height,
    sortOrder,
    isFallback,
  };
}

/**
 * Reserved fallback — assigned only when the curated pool is exhausted
 * or assignment cannot safely allocate a unique mark.
 * Multiple profiles may share UNMARKED.
 */
export const UNMARKED_SIGIL: GreenwoodSigilDefinition = {
  id: UNMARKED_SIGIL_ID,
  slug: "unmarked",
  asciiBody: ["  .  ", " . . ", "....."].join("\n"),
  a11yLabel: "Unmarked — reserved fallback sigil",
  width: 5,
  height: 3,
  sortOrder: 0,
  isFallback: true,
};

/** Exactly 64 curated assignable marks (sort_order 1–64). */
export const CURATED_GREENWOOD_SIGILS: readonly GreenwoodSigilDefinition[] = [
  def(1, "ember-notch", "  /\\\n /  \\\n/____\\\n  ||", "Ember notch — a small peaked mark", "1"),
  def(2, "twin-sparks", " *  *\n  \\/\n  /\\\n *  *", "Twin sparks facing across a gap", "2"),
  def(3, "ash-ring", " .--. \n(    )\n '--' ", "Ash ring — a simple closed circle", "3"),
  def(4, "split-bough", "  |  \n /|\\ \n/ | \\\n  |  ", "Split bough branching once", "4"),
  def(5, "hollow-gate", "[=|=]\n | | \n | | \n[=|=]", "Hollow gate of paired posts", "5"),
  def(6, "low-flame", "  )  \n ( ) \n(_._)", "Low flame cupped in ash", "6"),
  def(7, "thorn-pair", "  /\\\n //\\\\\n \\  /\n  \\/", "Thorn pair meeting at a point", "7"),
  def(8, "moss-step", "____\n|__|\n|  |\n|__|", "Moss step — stacked stone mark", "8"),
  def(9, "needle-fall", "  |  \n  |  \n \\|/ \n  '  ", "Needle fall from a high tip", "9"),
  def(10, "cinder-cross", "  +  \n--+--\n  +  ", "Cinder cross of four arms", "10"),
  def(11, "root-fork", "  |  \n  |  \n / \\ \n/   \\", "Root fork splitting downward", "11"),
  def(12, "smoke-curl", "  ~  \n ~ ~ \n~   ~\n  ~  ", "Smoke curl drifting upward", "12"),
  def(13, "bark-slash", "\\\\  //\n \\\\// \n  \\/  ", "Bark slash of crossing strokes", "13"),
  def(14, "seed-pod", "  ()  \n (  ) \n  )(  \n  ''  ", "Seed pod closed and hanging", "14"),
  def(15, "grove-posts", "| | |\n| | |\n|_|_|", "Three grove posts side by side", "15"),
  def(16, "ember-arc", "  __  \n /  \\ \n \\__/\n  ..  ", "Ember arc over cooling coals", "16"),
  def(17, "wedge-mark", "  /|\n / |\n/_/\n  '", "Wedge mark cut into wood", "17"),
  def(18, "night-hook", "  /~\n /\n \\\n  \\_", "Night hook curving once", "18"),
  def(19, "stone-pile", "  __\n /_/\\\n/_/\\_\\\n  ''", "Stone pile of rough angles", "19"),
  def(20, "reed-line", "| | |\n| | |\n \\|/\n  |", "Reed line bending to one stem", "20"),
  def(21, "coal-nest", " .  . \n. __ .\n'(__)'", "Coal nest holding a dark heart", "21"),
  def(22, "branch-y", " \\ / \n  ^  \n  |  \n  |  ", "Branch fork rising from a trunk", "22"),
  def(23, "rim-cut", "[----]\n|    |\n[----]", "Rim cut — open rectangular frame", "23"),
  def(24, "flint-edge", "  /|\n / |\n/__|\n\\   ", "Flint edge with a hard corner", "24"),
  def(25, "drip-mark", "  .  \n  |  \n  |  \n / \\ ", "Drip mark falling to a base", "25"),
  def(26, "knot-loop", " .--. \n/    \\\n\\    /\n '--' ", "Knot loop closed twice", "26"),
  def(27, "lean-spar", "   /\n  /\n /\n/", "Lean spar tilting left", "27"),
  def(28, "pitch-fork", "| | |\n \\|/ \n  |  \n  |  ", "Pitch fork of three tines", "28"),
  def(29, "ember-dot", "  .  \n .*. \n.*.*.\n  '  ", "Ember dots arranged as a spark", "29"),
  def(30, "ridge-line", "/\\/\\/\n\\/\\/\\\n  --  ", "Ridge line of repeating peaks", "30"),
  def(31, "cup-mark", "\\   /\n \\_/ \n  |  \n  |  ", "Cup mark held above a stem", "31"),
  def(32, "bar-gate", "====\n || \n || \n====", "Bar gate of twin uprights", "32"),
  def(33, "twist-vine", "  /\\\n \\/\\\n /\\/\n \\/", "Twist vine of interlocking zigzags", "33"),
  def(34, "hearth-box", "+--+\n|..|\n|..|\n+--+", "Hearth box with inner embers", "34"),
  def(35, "spike-rise", "  ^  \n /|\\ \n  |  \n  |  ", "Spike rise pointing upward", "35"),
  def(36, "owl-notch", " . . \n(   )\n \\_/ ", "Owl notch — paired hollow eyes", "36"),
  def(37, "trail-dash", "- - -\n - - \n- - -\n  .  ", "Trail dash of broken steps", "37"),
  def(38, "wedge-pair", "/\\/\\\n\\/\\/\n /\\ \n \\/ ", "Wedge pair interlocking", "38"),
  def(39, "post-and-beam", "|---|\n|   |\n|---|\n|   |", "Post and beam frame", "39"),
  def(40, "curl-leaf", "  ,  \n / \\ \n \\_/ \n  '  ", "Curl leaf resting on a tip", "40"),
  def(41, "ash-ladder", "|=|\n|=|\n|=|\n|=|", "Ash ladder of four rungs", "41"),
  def(42, "broken-ring", " .-. \n(   \\\n \\   )\n  '-' ", "Broken ring left open", "42"),
  def(43, "stake-mark", "  |\n  |\n /|\\\n/_|_\\", "Stake mark driven into ground", "43"),
  def(44, "double-hook", "~~\\\n   )\n~~/\n   ", "Double hook of paired curves", "44"),
  def(45, "pine-tip", "  ^\n /^\\\n/^^^\\\n  |", "Pine tip tapering to a point", "45"),
  def(46, "ember-bowl", "\\___/\n | |\n |_|", "Ember bowl on short legs", "46"),
  def(47, "cross-path", "  |  \n--+--\n  |  \n  |  ", "Cross path with a long stem", "47"),
  def(48, "shard-fan", "\\ | /\n \\|/ \n  |  ", "Shard fan of three blades", "48"),
  def(49, "low-arch", " /¯¯\\\n/    \\\n\\____/", "Low arch spanning a base", "49"),
  def(50, "dot-column", " .\n .\n .\n_._", "Dot column above a base mark", "50"),
  def(51, "hinge-mark", "[|]\n | \n[|]\n | ", "Hinge mark of stacked brackets", "51"),
  def(52, "wave-ash", "~ ~~\n ~~ \n~ ~~\n  . ", "Wave ash of soft undulation", "52"),
  def(53, "trench-cut", "____\n\\  /\n \\/\n ||", "Trench cut narrowing downward", "53"),
  def(54, "twin-posts", "|  |\n|  |\n|__|\n'  '", "Twin posts joined at the base", "54"),
  def(55, "ember-chevron", "  ^  \n / \\ \n/   \\\n-----", "Ember chevron over a bar", "55"),
  def(56, "coil-mark", "  @  \n @ @ \n@   @\n @@@ ", "Coil mark in a tight spiral", "56"),
  def(57, "gap-bridge", "|==|\n|  |\n|==|\n \\/ ", "Gap bridge with a hanging tip", "57"),
  def(58, "flint-stack", "  _\n /_\\\n/_._\\\n \\_/", "Flint stack of nested layers", "58"),
  def(59, "silent-bell", " .-. \n(   )\n \\_/ \n  |  ", "Silent bell hanging still", "59"),
  def(60, "ridge-post", " /\\\n/||\\\n || \n || ", "Ridge post under a peak", "60"),
  def(61, "ember-rail", "=||=\n || \n || \n'--'", "Ember rail between short bars", "61"),
  def(62, "open-cradle", "\\   /\n \\ /\n  \\/ \n  |  ", "Open cradle narrowing to a point", "62"),
  def(63, "night-stake", "  !  \n  |  \n / \\ \n/___\\", "Night stake with a warning tip", "63"),
  def(64, "last-coal", "  *  \n * * \n*___*\n ''' ", "Last coal among fading sparks", "64"),
] as const;

export const ALL_GREENWOOD_SIGIL_DEFINITIONS: readonly GreenwoodSigilDefinition[] =
  [UNMARKED_SIGIL, ...CURATED_GREENWOOD_SIGILS];

export function assertSigilGeometry(
  sigil: GreenwoodSigilDefinition,
): string | null {
  if (sigil.width > GREENWOOD_SIGIL_MAX_WIDTH) {
    return `${sigil.slug}: width ${sigil.width} exceeds ${GREENWOOD_SIGIL_MAX_WIDTH}`;
  }
  if (
    sigil.height < GREENWOOD_SIGIL_MIN_HEIGHT ||
    sigil.height > GREENWOOD_SIGIL_MAX_HEIGHT
  ) {
    return `${sigil.slug}: height ${sigil.height} outside ${GREENWOOD_SIGIL_MIN_HEIGHT}-${GREENWOOD_SIGIL_MAX_HEIGHT}`;
  }
  const measured = measure(sigil.asciiBody);
  if (measured.width !== sigil.width || measured.height !== sigil.height) {
    return `${sigil.slug}: declared size ${sigil.width}x${sigil.height} != measured ${measured.width}x${measured.height}`;
  }
  if (/[0-9A-Za-z]/.test(sigil.asciiBody) && !sigil.isFallback) {
    // Allow only structural punctuation; block identity-like glyphs in body.
    // Fallback may use dots only (already no letters). Curated: no alphanumerics.
    return `${sigil.slug}: ascii body contains alphanumeric characters`;
  }
  return null;
}
