"use client";

import { useEffect, useState } from "react";

type LoreFrame = {
  ascii: string;
  line: string;
};

/** Curated transmission frames — cycle slowly; not a carousel. */
export const LORE_TRANSMISSION_FRAMES: LoreFrame[] = [
  {
    ascii: `    /|
   / |
  /  |→→
 -----`,
    line: "the wood keeps better records than the crown.",
  },
  {
    ascii: `  .  .
 /|/\\|\\
   ||`,
    line: "Talking to the Camp makes FENN smarter.",
  },
  {
    ascii: `  ←──╳──→
     |
    / \\`,
    line: "a path breaks. another forms.",
  },
  {
    ascii: `     ^
    /|\\
   /_|_\\
    |||`,
    line: "What the Crown keeps, the Greenwood shares.",
  },
  {
    ascii: `  >>>···
  ···>>>`,
    line: "some paths open only after you have earned them.",
  },
  {
    ascii: `   (  )
  /    \\
 | HOOD |
  \\    /
   \`--'`,
    line: "the first outlaw was first because someone had to be.",
  },
  {
    ascii: `  $ → → → ?
     ·`,
    line: "A hoard is a failure of circulation.",
  },
];

const CYCLE_MS = 3200;
const FADE_MS = 280;

export function LoreTransmission() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    let fadeTimer: number | undefined;
    const cycleTimer = window.setInterval(() => {
      setPhase("out");
      fadeTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % LORE_TRANSMISSION_FRAMES.length);
        setPhase("in");
      }, FADE_MS);
    }, CYCLE_MS);

    return () => {
      window.clearInterval(cycleTimer);
      if (fadeTimer !== undefined) {
        window.clearTimeout(fadeTimer);
      }
    };
  }, [reduceMotion]);

  const frame = LORE_TRANSMISSION_FRAMES[index] ?? LORE_TRANSMISSION_FRAMES[0];

  return (
    <section
      className="home-section home-transmission"
      aria-label="transmission"
      aria-live="polite"
    >
      <p className="home-transmission__label muted">:: transmission ::</p>
      <div
        className={
          reduceMotion
            ? "home-transmission__frame"
            : `home-transmission__frame home-transmission__frame--${phase}`
        }
      >
        <pre className="ascii home-transmission__ascii" aria-hidden="true">
          {frame.ascii}
        </pre>
        <p className="home-transmission__line">{frame.line}</p>
      </div>
    </section>
  );
}
