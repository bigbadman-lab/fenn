import { GREENWOOD_GATE_ASCII } from "@/components/greenwood/greenwood-frames";

/** Full-screen woodland reveal — denser than the gate heading, Crossing-related. */
export const GREENWOOD_ARRIVAL_ASCII_DESKTOP = `${GREENWOOD_GATE_ASCII}

            the trees remember the road
                 the path closes behind

                    |||
                &&&&  |||  &&&&
                     \\|||/
                      \\|/
                       v`;

/** Narrower scene for mobile — no horizontal overflow. */
export const GREENWOOD_ARRIVAL_ASCII_MOBILE = `        /\\
   /\\   /  \\   /\\
  /  \\ / /\\ \\ /  \\
 /____V_/__\\_V____\\
   ||    ||    ||
||||||||||||||||||||
 the wood stands open

      |||
  &&  |||  &&
     \\|||/
      \\|/
       v`;

export const GREENWOOD_ARRIVAL_LINES = [
  "You have walked the Road honestly.",
  "The Greenwood remembers.",
  "What was once closed now stands open.",
  "Enter quietly.",
] as const;

export const GREENWOOD_ARRIVAL_CLOSING = [
  "Some roads lead to places.",
  "This one led to people.",
] as const;

/** Timing (ms). Restrained; not a character-by-character typewriter. */
export const GREENWOOD_ARRIVAL_TIMING = {
  darknessMs: 1100,
  sceneRevealMs: 1400,
  linePauseMs: 1400,
  afterLinesMs: 900,
  closingPauseMs: 1600,
  holdMs: 2000,
  fadeOutMs: 900,
  /** Absolute failsafe so a broken timer cannot trap the member. */
  maxTotalMs: 28000,
  reducedTotalMs: 2200,
} as const;
