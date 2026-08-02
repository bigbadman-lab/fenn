"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  GREENWOOD_ARRIVAL_ASCII_DESKTOP,
  GREENWOOD_ARRIVAL_ASCII_MOBILE,
  GREENWOOD_ARRIVAL_CLOSING,
  GREENWOOD_ARRIVAL_LINES,
  GREENWOOD_ARRIVAL_TIMING,
} from "@/components/greenwood/greenwood-arrival-frames";

type GreenwoodArrivalCeremonyProps = {
  reducedMotion: boolean;
  onComplete: () => void;
};

type Phase =
  | "darkness"
  | "scene"
  | "lines"
  | "closing"
  | "hold"
  | "fade"
  | "done";

function subscribeNowhere() {
  return () => undefined;
}

function useIsClient() {
  return useSyncExternalStore(subscribeNowhere, () => true, () => false);
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

/**
 * One-time full-screen Greenwood arrival after first admission.
 * Presentation only — durable completion is persisted by the caller.
 */
export function GreenwoodArrivalCeremony({
  reducedMotion,
  onComplete,
}: GreenwoodArrivalCeremonyProps) {
  const statusId = useId();
  const isClient = useIsClient();
  const narrow = useIsNarrow();
  const onCompleteRef = useRef(onComplete);
  const finishedRef = useRef(false);
  const activeRef = useRef(true);

  const [phase, setPhase] = useState<Phase>(() =>
    reducedMotion ? "lines" : "darkness",
  );
  const [visibleLineCount, setVisibleLineCount] = useState(() =>
    reducedMotion ? GREENWOOD_ARRIVAL_LINES.length : 0,
  );
  const [showClosing, setShowClosing] = useState(() => reducedMotion);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    activeRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const previousActive = document.activeElement;
    if (previousActive instanceof HTMLElement) {
      previousActive.blur();
    }

    return () => {
      activeRef.current = false;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const after = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    const finish = () => {
      if (finishedRef.current || !activeRef.current) return;
      finishedRef.current = true;
      setPhase("done");
      onCompleteRef.current();
    };

    // Absolute failsafe — never trap the member on a broken animation.
    after(GREENWOOD_ARRIVAL_TIMING.maxTotalMs, finish);

    if (reducedMotion) {
      after(GREENWOOD_ARRIVAL_TIMING.reducedTotalMs, () => {
        setPhase("fade");
        after(400, finish);
      });
      return () => {
        for (const t of timers) window.clearTimeout(t);
      };
    }

    let elapsed = 0;

    after(GREENWOOD_ARRIVAL_TIMING.darknessMs, () => {
      if (!activeRef.current) return;
      setPhase("scene");
    });
    elapsed += GREENWOOD_ARRIVAL_TIMING.darknessMs;

    after(elapsed + GREENWOOD_ARRIVAL_TIMING.sceneRevealMs, () => {
      if (!activeRef.current) return;
      setPhase("lines");
      setVisibleLineCount(1);
    });
    elapsed += GREENWOOD_ARRIVAL_TIMING.sceneRevealMs;

    for (let i = 1; i < GREENWOOD_ARRIVAL_LINES.length; i += 1) {
      const count = i + 1;
      after(elapsed + GREENWOOD_ARRIVAL_TIMING.linePauseMs * i, () => {
        if (!activeRef.current) return;
        setVisibleLineCount(count);
      });
    }
    elapsed +=
      GREENWOOD_ARRIVAL_TIMING.linePauseMs *
      (GREENWOOD_ARRIVAL_LINES.length - 1);

    after(elapsed + GREENWOOD_ARRIVAL_TIMING.afterLinesMs, () => {
      if (!activeRef.current) return;
      setPhase("closing");
      setShowClosing(true);
    });
    elapsed += GREENWOOD_ARRIVAL_TIMING.afterLinesMs;

    after(elapsed + GREENWOOD_ARRIVAL_TIMING.closingPauseMs, () => {
      if (!activeRef.current) return;
      setPhase("hold");
    });
    elapsed += GREENWOOD_ARRIVAL_TIMING.closingPauseMs;

    after(elapsed + GREENWOOD_ARRIVAL_TIMING.holdMs, () => {
      if (!activeRef.current) return;
      setPhase("fade");
    });
    elapsed += GREENWOOD_ARRIVAL_TIMING.holdMs;

    after(elapsed + GREENWOOD_ARRIVAL_TIMING.fadeOutMs, finish);

    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [reducedMotion]);

  const ascii = narrow
    ? GREENWOOD_ARRIVAL_ASCII_MOBILE
    : GREENWOOD_ARRIVAL_ASCII_DESKTOP;

  const showScene = phase !== "darkness";
  const fading = phase === "fade" || phase === "done";

  const overlay = (
    <div
      className={[
        "greenwood-arrival",
        reducedMotion ? "greenwood-arrival--reduced" : "",
        fading ? "greenwood-arrival--fade" : "",
        phase === "darkness" ? "greenwood-arrival--dark" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
      aria-busy={phase !== "done"}
      aria-describedby={statusId}
    >
      <p id={statusId} className="visually-hidden">
        Arriving in the Greenwood. Enter quietly.
      </p>

      {showScene ? (
        <pre
          className="ascii greenwood-arrival__scene"
          aria-hidden="true"
        >
          {ascii}
        </pre>
      ) : null}

      <div className="greenwood-arrival__copy">
        {GREENWOOD_ARRIVAL_LINES.slice(0, visibleLineCount).map((line) => (
          <p key={line} className="greenwood-arrival__line">
            {line}
          </p>
        ))}
        {showClosing
          ? GREENWOOD_ARRIVAL_CLOSING.map((line) => (
              <p key={line} className="greenwood-arrival__closing">
                {line}
              </p>
            ))
          : null}
      </div>
    </div>
  );

  if (!isClient) {
    return overlay;
  }

  return createPortal(overlay, document.body);
}
