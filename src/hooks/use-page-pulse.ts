"use client";

import { useEffect, useRef } from "react";

export type UsePagePulseOptions = {
  /** Interval between pulses while the tab is visible. */
  intervalMs: number;
  /** Called on each pulse. Should be stable or wrapped by the caller. */
  onPulse: () => void;
  /** When false, no timers/listeners. Default true. */
  enabled?: boolean;
  /** Refresh promptly when the tab becomes visible again. Default true. */
  refreshOnVisible?: boolean;
};

/**
 * Tiny page pulse: interval while visible, skip while hidden,
 * optional immediate pulse on visibility regain.
 * Cleans up on unmount. Safe under React Strict Mode.
 */
export function usePagePulse({
  intervalMs,
  onPulse,
  enabled = true,
  refreshOnVisible = true,
}: UsePagePulseOptions): void {
  const onPulseRef = useRef(onPulse);

  useEffect(() => {
    onPulseRef.current = onPulse;
  }, [onPulse]);

  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(intervalMs) || intervalMs < 1_000) return;

    let cancelled = false;
    let intervalId: number | null = null;

    const clear = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const pulse = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      onPulseRef.current();
    };

    const startInterval = () => {
      clear();
      if (cancelled || document.hidden) return;
      intervalId = window.setInterval(pulse, intervalMs);
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.hidden) {
        clear();
        return;
      }
      if (refreshOnVisible) {
        onPulseRef.current();
      }
      startInterval();
    };

    if (!document.hidden) {
      startInterval();
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, refreshOnVisible]);
}
