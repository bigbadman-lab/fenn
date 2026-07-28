/**
 * Homepage map wanderer — pure path / waypoint logic.
 * Atmospheric only: no navigation state, no persistence, no server writes.
 *
 * Movement stays on empty monospace cells so FENN does not cover map ASCII.
 */

import {
  FENN_WORLD_MAP_DESKTOP_GRID,
  FENN_WORLD_MAP_DESKTOP_WIDTH,
  FENN_WORLD_MAP_MOBILE_GRID,
  FENN_WORLD_MAP_MOBILE_WIDTH,
} from "@/content/home-world-map";

export type FennMapWaypointId =
  | "book"
  | "oak"
  | "camp"
  | "deeds"
  | "ledger"
  | "commons"
  | "wall"
  | "greenwood"
  | "greenwood_gate";

export type FennMapVariant = "desktop" | "mobile";

export type FennMapCell = {
  row: number;
  col: number;
};

export type FennMapPoint = {
  /** Percent of map art width (0–100). */
  x: number;
  /** Percent of map art height (0–100). */
  y: number;
};

/** Idle footprint in map cells (sprite sits fully inside). */
export const FENN_IDLE_FOOTPRINT: Record<
  FennMapVariant,
  { rows: number; cols: number }
> = {
  desktop: { rows: 3, cols: 5 },
  mobile: { rows: 2, cols: 4 },
};

/** Travel footprint — slightly smaller so corridors between clearings connect. */
export const FENN_TRAVEL_FOOTPRINT: Record<
  FennMapVariant,
  { rows: number; cols: number }
> = {
  desktop: { rows: 1, cols: 3 },
  mobile: { rows: 1, cols: 2 },
};

/**
 * Label centres used to seed nearest-empty idle pads.
 * Must match landmarks in home-world-map.ts.
 */
const LABEL_SEEDS: Record<
  FennMapVariant,
  Record<FennMapWaypointId, FennMapCell>
> = {
  desktop: {
    book: { row: 5, col: 8 },
    oak: { row: 5, col: 110 },
    greenwood_gate: { row: 19, col: 34 },
    greenwood: { row: 22, col: 36 },
    deeds: { row: 25, col: 5 },
    camp: { row: 25, col: 110 },
    wall: { row: 30, col: 8 },
    ledger: { row: 33, col: 14 },
    commons: { row: 35, col: 65 },
  },
  mobile: {
    book: { row: 0, col: 58 },
    oak: { row: 0, col: 72 },
    wall: { row: 5, col: 6 },
    deeds: { row: 6, col: 4 },
    camp: { row: 6, col: 72 },
    greenwood_gate: { row: 7, col: 38 },
    ledger: { row: 8, col: 7 },
    greenwood: { row: 9, col: 69 },
    commons: { row: 10, col: 7 },
  },
};

export function mapGrid(variant: FennMapVariant): readonly string[] {
  return variant === "desktop"
    ? FENN_WORLD_MAP_DESKTOP_GRID
    : FENN_WORLD_MAP_MOBILE_GRID;
}

export function mapWidth(variant: FennMapVariant): number {
  return variant === "desktop"
    ? FENN_WORLD_MAP_DESKTOP_WIDTH
    : FENN_WORLD_MAP_MOBILE_WIDTH;
}

export function isRectClear(
  grid: readonly string[],
  width: number,
  cell: FennMapCell,
  rows: number,
  cols: number,
): boolean {
  if (
    cell.row < 0 ||
    cell.col < 0 ||
    cell.row + rows > grid.length ||
    cell.col + cols > width
  ) {
    return false;
  }
  for (let r = cell.row; r < cell.row + rows; r += 1) {
    const line = grid[r]!;
    for (let c = cell.col; c < cell.col + cols; c += 1) {
      if (line[c] !== " ") return false;
    }
  }
  return true;
}

/** Nearest empty idle pad to a seed; avoids overlapping already-chosen pads. */
export function findNearestClearPad(
  grid: readonly string[],
  width: number,
  seed: FennMapCell,
  footprint: { rows: number; cols: number },
  occupied: readonly FennMapCell[] = [],
): FennMapCell | null {
  const { rows, cols } = footprint;
  let best: FennMapCell | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const overlaps = (a: FennMapCell, b: FennMapCell) =>
    !(
      a.row + rows <= b.row ||
      b.row + rows <= a.row ||
      a.col + cols <= b.col ||
      b.col + cols <= a.col
    );

  for (let row = 0; row <= grid.length - rows; row += 1) {
    for (let col = 0; col <= width - cols; col += 1) {
      const cell = { row, col };
      if (!isRectClear(grid, width, cell, rows, cols)) continue;
      if (occupied.some((o) => overlaps(o, cell))) continue;

      const cr = row + rows / 2;
      const cc = col + cols / 2;
      // Prefer pads below the landmark so FENN stands in open ground.
      const belowBias = row >= seed.row ? 0 : 1.75;
      const score =
        Math.hypot(cr - seed.row, cc - seed.col) + belowBias;
      if (score < bestScore) {
        bestScore = score;
        best = cell;
      }
    }
  }
  return best;
}

function buildWaypointCells(
  variant: FennMapVariant,
): Record<FennMapWaypointId, FennMapCell> {
  const grid = mapGrid(variant);
  const width = mapWidth(variant);
  const footprint = FENN_IDLE_FOOTPRINT[variant];
  const order = Object.keys(LABEL_SEEDS[variant]) as FennMapWaypointId[];
  const occupied: FennMapCell[] = [];
  const out = {} as Record<FennMapWaypointId, FennMapCell>;

  for (const id of order) {
    const pad = findNearestClearPad(
      grid,
      width,
      LABEL_SEEDS[variant][id],
      footprint,
      occupied,
    );
    if (!pad) {
      throw new Error(`No clear idle pad for ${variant}/${id}`);
    }
    occupied.push(pad);
    out[id] = pad;
  }
  return out;
}

export const FENN_MAP_CELLS: Record<
  FennMapVariant,
  Record<FennMapWaypointId, FennMapCell>
> = {
  desktop: buildWaypointCells("desktop"),
  mobile: buildWaypointCells("mobile"),
};

export function cellToPoint(
  variant: FennMapVariant,
  cell: FennMapCell,
  footprint: { rows: number; cols: number } = FENN_IDLE_FOOTPRINT[variant],
): FennMapPoint {
  const grid = mapGrid(variant);
  const width = mapWidth(variant);
  return {
    x: ((cell.col + footprint.cols / 2) / width) * 100,
    y: ((cell.row + footprint.rows / 2) / grid.length) * 100,
  };
}

/**
 * Percent anchors for each waypoint (derived from clear pads).
 * Kept for tests / callers that prefer x/y.
 */
export const FENN_MAP_WAYPOINTS: Record<
  FennMapVariant,
  Record<FennMapWaypointId, FennMapPoint>
> = {
  desktop: Object.fromEntries(
    (Object.keys(FENN_MAP_CELLS.desktop) as FennMapWaypointId[]).map((id) => [
      id,
      cellToPoint("desktop", FENN_MAP_CELLS.desktop[id]),
    ]),
  ) as Record<FennMapWaypointId, FennMapPoint>,
  mobile: Object.fromEntries(
    (Object.keys(FENN_MAP_CELLS.mobile) as FennMapWaypointId[]).map((id) => [
      id,
      cellToPoint("mobile", FENN_MAP_CELLS.mobile[id]),
    ]),
  ) as Record<FennMapWaypointId, FennMapPoint>,
};

/** Places FENN may idle at (gate is approach-only). */
export const FENN_MAP_IDLE_WAYPOINTS: readonly FennMapWaypointId[] = [
  "book",
  "oak",
  "camp",
  "deeds",
  "ledger",
  "commons",
  "wall",
  "greenwood",
] as const;

/**
 * Undirected route graph from desktop landscape adjacency.
 * Mobile reuses the same graph (positions differ; connectivity is shared lore).
 */
export const FENN_MAP_ROUTES: Readonly<
  Record<FennMapWaypointId, readonly FennMapWaypointId[]>
> = {
  book: ["oak", "greenwood_gate", "deeds"],
  oak: ["book", "camp", "greenwood_gate"],
  camp: ["oak", "greenwood", "ledger", "commons"],
  deeds: ["book", "wall", "greenwood", "greenwood_gate"],
  wall: ["deeds", "ledger", "greenwood_gate"],
  ledger: ["wall", "commons", "camp", "deeds"],
  commons: ["ledger", "camp", "wall"],
  greenwood: ["greenwood_gate", "deeds", "camp", "wall"],
  greenwood_gate: ["greenwood", "book", "oak", "deeds", "wall"],
};

export type FennWanderPhase =
  | "idle"
  | "walking"
  | "greenwood_approach"
  | "greenwood_linger";

export type FennAtmosphericLine =
  | "FENN waits."
  | "FENN is watching."
  | "FENN is walking."
  | "FENN stands at the Greenwood."
  | "FENN has gone elsewhere."
  | null;

/** Idle linger bounds (ms) — deliberate stillness. */
export const FENN_IDLE_MS_MIN = 9_000;
export const FENN_IDLE_MS_MAX = 22_000;

/** Greenwood linger at the gate / threshold. */
export const FENN_GREENWOOD_LINGER_MS_MIN = 7_000;
export const FENN_GREENWOOD_LINGER_MS_MAX = 14_000;

/** Discrete walk step interval (awkward terminal steps). */
export const FENN_WALK_STEP_MS = 220;

/** How often to bias toward a Greenwood visit. */
export const FENN_GREENWOOD_VISIT_CHANCE = 0.28;

/** Subsample long clear paths so travel stays slow but bounded. */
export const FENN_PATH_MAX_STEPS = 28;

export function neighborsOf(
  id: FennMapWaypointId,
): readonly FennMapWaypointId[] {
  return FENN_MAP_ROUTES[id];
}

export function isRouteValid(
  from: FennMapWaypointId,
  to: FennMapWaypointId,
): boolean {
  return FENN_MAP_ROUTES[from].includes(to);
}

/**
 * BFS through empty cells using the travel footprint.
 * Returns a list of top-left cells from `from` to `to` (inclusive).
 */
export function findClearPath(
  variant: FennMapVariant,
  from: FennMapCell,
  to: FennMapCell,
): FennMapCell[] | null {
  const grid = mapGrid(variant);
  const width = mapWidth(variant);
  const { rows, cols } = FENN_TRAVEL_FOOTPRINT[variant];

  if (!isRectClear(grid, width, from, rows, cols)) return null;
  if (!isRectClear(grid, width, to, rows, cols)) return null;

  const key = (c: FennMapCell) => `${c.row},${c.col}`;
  const queue: FennMapCell[] = [from];
  const prev = new Map<string, FennMapCell | null>([[key(from), null]]);
  const dirs: Array<[number, number]> = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.row === to.row && cur.col === to.col) {
      const path: FennMapCell[] = [];
      let walk: FennMapCell | null = cur;
      while (walk) {
        path.push(walk);
        walk = prev.get(key(walk)) ?? null;
      }
      return path.reverse();
    }

    for (const [dr, dc] of dirs) {
      const next = { row: cur.row + dr, col: cur.col + dc };
      const k = key(next);
      if (prev.has(k)) continue;
      if (!isRectClear(grid, width, next, rows, cols)) continue;
      prev.set(k, cur);
      queue.push(next);
    }
  }

  return null;
}

/** Path between named waypoints, subsampled for animation. */
export function pathBetweenWaypoints(
  variant: FennMapVariant,
  fromId: FennMapWaypointId,
  toId: FennMapWaypointId,
): FennMapCell[] {
  const from = FENN_MAP_CELLS[variant][fromId];
  const to = FENN_MAP_CELLS[variant][toId];
  const full = findClearPath(variant, from, to);
  if (!full || full.length === 0) {
    // Should not happen for valid route edges; fall back to endpoints only.
    return [from, to];
  }
  return subsamplePath(full, FENN_PATH_MAX_STEPS);
}

export function subsamplePath(
  path: FennMapCell[],
  maxSteps: number,
): FennMapCell[] {
  if (path.length <= maxSteps) return path;
  const out: FennMapCell[] = [];
  const last = path.length - 1;
  for (let i = 0; i < maxSteps; i += 1) {
    const idx = Math.round((i / (maxSteps - 1)) * last);
    const cell = path[idx]!;
    const prev = out[out.length - 1];
    if (!prev || prev.row !== cell.row || prev.col !== cell.col) {
      out.push(cell);
    }
  }
  return out;
}

export function interpolatePoint(
  from: FennMapPoint,
  to: FennMapPoint,
  t: number,
): FennMapPoint {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
  };
}

/** Bounded deterministic pick from [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickBoundedMs(
  rand: () => number,
  min: number,
  max: number,
): number {
  return Math.floor(min + rand() * (max - min + 1));
}

export function pickNeighbor(
  current: FennMapWaypointId,
  rand: () => number,
  opts?: { preferGreenwood?: boolean; avoid?: FennMapWaypointId },
): FennMapWaypointId {
  const options = neighborsOf(current).filter((n) => n !== opts?.avoid);
  if (options.length === 0) {
    return neighborsOf(current)[0] ?? current;
  }

  if (opts?.preferGreenwood) {
    const gateish = options.filter(
      (n) => n === "greenwood" || n === "greenwood_gate",
    );
    if (gateish.length > 0) {
      return gateish[Math.floor(rand() * gateish.length)]!;
    }
  }

  return options[Math.floor(rand() * options.length)]!;
}

/**
 * Choose next destination from an idle place.
 * Sometimes routes toward Greenwood for environmental storytelling.
 */
export function chooseNextDestination(
  current: FennMapWaypointId,
  rand: () => number,
): { target: FennMapWaypointId; greenwoodVisit: boolean } {
  const prefer =
    current !== "greenwood" &&
    current !== "greenwood_gate" &&
    rand() < FENN_GREENWOOD_VISIT_CHANCE;

  if (prefer) {
    const toward = neighborsOf(current).filter(
      (n) =>
        n === "greenwood" ||
        n === "greenwood_gate" ||
        neighborsOf(n).includes("greenwood") ||
        neighborsOf(n).includes("greenwood_gate"),
    );
    if (toward.length > 0) {
      return {
        target: toward[Math.floor(rand() * toward.length)]!,
        greenwoodVisit: true,
      };
    }
  }

  const target = pickNeighbor(current, rand, {
    avoid: current === "greenwood_gate" ? "greenwood" : undefined,
  });

  return {
    target,
    greenwoodVisit:
      target === "greenwood" || target === "greenwood_gate" || prefer,
  };
}

export function atmosphericLineFor(
  phase: FennWanderPhase,
  at: FennMapWaypointId,
): FennAtmosphericLine {
  if (phase === "walking" || phase === "greenwood_approach") {
    return "FENN is walking.";
  }
  if (phase === "greenwood_linger") {
    return "FENN stands at the Greenwood.";
  }
  if (at === "greenwood" || at === "greenwood_gate") {
    return "FENN stands at the Greenwood.";
  }
  if (at === "oak" || at === "book") {
    return "FENN is watching.";
  }
  return "FENN waits.";
}

/** Timers should run only when the document is visible and motion is allowed. */
export function shouldRunWanderTimers(opts: {
  documentVisible: boolean;
  reduceMotion: boolean;
}): boolean {
  return opts.documentVisible && !opts.reduceMotion;
}

export function isGreenwoodSpecialVisit(id: FennMapWaypointId): boolean {
  return id === "greenwood" || id === "greenwood_gate";
}

/** Confirm every idle waypoint is on the route graph. */
export function assertRouteGraphIntegrity(): boolean {
  for (const id of FENN_MAP_IDLE_WAYPOINTS) {
    if (!FENN_MAP_ROUTES[id] || FENN_MAP_ROUTES[id].length === 0) {
      return false;
    }
  }
  const reach = new Set<FennMapWaypointId>();
  const queue: FennMapWaypointId[] = ["camp"];
  while (queue.length) {
    const n = queue.pop()!;
    if (reach.has(n)) continue;
    reach.add(n);
    for (const next of FENN_MAP_ROUTES[n]) queue.push(next);
  }
  return reach.has("greenwood") && reach.has("greenwood_gate");
}

/** Every waypoint idle pad is fully empty ASCII. */
export function assertWaypointClearance(variant: FennMapVariant): boolean {
  const grid = mapGrid(variant);
  const width = mapWidth(variant);
  const { rows, cols } = FENN_IDLE_FOOTPRINT[variant];
  for (const id of Object.keys(FENN_MAP_CELLS[variant]) as FennMapWaypointId[]) {
    if (!isRectClear(grid, width, FENN_MAP_CELLS[variant][id], rows, cols)) {
      return false;
    }
  }
  return true;
}

/** Every route edge has a clear travel path through empty cells. */
export function assertRouteClearance(variant: FennMapVariant): boolean {
  const seen = new Set<string>();
  for (const from of Object.keys(FENN_MAP_ROUTES) as FennMapWaypointId[]) {
    for (const to of FENN_MAP_ROUTES[from]) {
      const key = [from, to].sort().join(">");
      if (seen.has(key)) continue;
      seen.add(key);
      const path = findClearPath(
        variant,
        FENN_MAP_CELLS[variant][from],
        FENN_MAP_CELLS[variant][to],
      );
      if (!path) return false;
    }
  }
  return true;
}
