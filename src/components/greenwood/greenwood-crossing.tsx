"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  GREENWOOD_CROSSING_FRAMES,
  GREENWOOD_CROSSING_REDUCED_MS,
  type CrossingFrame,
} from "@/components/greenwood/greenwood-frames";

type GreenwoodCrossingProps = {
  reducedMotion: boolean;
  onComplete: () => void;
};

function frameClassName(frame: CrossingFrame): string {
  return [
    "greenwood-crossing__frame",
    `greenwood-crossing__frame--${frame.variant}`,
    `greenwood-crossing__frame--motion-${frame.motion}`,
    frame.accent !== "none"
      ? `greenwood-crossing__frame--accent-${frame.accent}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function subscribeNowhere() {
  return () => undefined;
}

function useIsClient() {
  return useSyncExternalStore(subscribeNowhere, () => true, () => false);
}

export function GreenwoodCrossing({
  reducedMotion,
  onComplete,
}: GreenwoodCrossingProps) {
  const statusId = useId();
  const isClient = useIsClient();
  const [frameIndex, setFrameIndex] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const activeRef = useRef(true);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    activeRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      activeRef.current = false;
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      const timer = window.setTimeout(() => {
        if (activeRef.current) {
          onCompleteRef.current();
        }
      }, GREENWOOD_CROSSING_REDUCED_MS);
      return () => window.clearTimeout(timer);
    }

    let index = 0;
    let timer: number | undefined;

    const advance = () => {
      const current = GREENWOOD_CROSSING_FRAMES[index];
      if (!current) {
        if (activeRef.current) {
          onCompleteRef.current();
        }
        return;
      }

      timer = window.setTimeout(() => {
        index += 1;
        if (index >= GREENWOOD_CROSSING_FRAMES.length) {
          if (activeRef.current) {
            onCompleteRef.current();
          }
          return;
        }
        if (activeRef.current) {
          setFrameIndex(index);
          advance();
        }
      }, current.holdMs);
    };

    advance();

    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [reducedMotion]);

  const frame =
    GREENWOOD_CROSSING_FRAMES[reducedMotion ? 0 : frameIndex] ??
    GREENWOOD_CROSSING_FRAMES[0];

  const overlay = (
    <div
      className={
        reducedMotion
          ? "greenwood-crossing greenwood-crossing--reduced"
          : "greenwood-crossing"
      }
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-describedby={statusId}
    >
      <p id={statusId} className="visually-hidden">
        Crossing into the Greenwood. Finding the path.
      </p>
      <pre className={frameClassName(frame)} aria-hidden="true">
        {frame.text}
      </pre>
    </div>
  );

  if (!isClient) {
    return overlay;
  }

  return createPortal(overlay, document.body);
}
