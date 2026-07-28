"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { usePagePulse } from "@/hooks/use-page-pulse";
import { WORLD_PULSE_DEEDS_MS } from "@/lib/world-pulse/intervals";

type DeedsBoardPulseProps = {
  /** ISO ends_at values from currently listed deeds (optional). */
  endsAtList?: Array<string | null | undefined>;
};

/**
 * Board pulse: ~60s refresh while visible + near-deadline one-shot refresh.
 * Does not own Deed open/closed policy — server remains authority after refresh.
 */
export function DeedsBoardPulse({ endsAtList = [] }: DeedsBoardPulseProps) {
  const router = useRouter();
  const onPulse = useCallback(() => {
    router.refresh();
  }, [router]);

  usePagePulse({
    intervalMs: WORLD_PULSE_DEEDS_MS,
    onPulse,
    refreshOnVisible: true,
  });

  const nearestEndsAtMs = nearestFutureEndsAtMs(endsAtList);

  useEffect(() => {
    if (nearestEndsAtMs == null) return;

    const delay = Math.max(0, nearestEndsAtMs - Date.now() + 250);
    // Cap far-future timeouts; interval pulse covers the rest.
    if (delay > WORLD_PULSE_DEEDS_MS * 2) return;

    const id = window.setTimeout(() => {
      if (document.hidden) return;
      router.refresh();
    }, delay);

    return () => window.clearTimeout(id);
  }, [nearestEndsAtMs, router]);

  return null;
}

/**
 * Detail pulse: visibility + deadline only — no periodic refresh.
 * Preserves submission form draft state on the detail page.
 */
export function DeedsDetailPulse({
  endsAt,
}: {
  endsAt: string | null | undefined;
}) {
  const router = useRouter();
  const refreshedForDeadline = useRef(false);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  useEffect(() => {
    refreshedForDeadline.current = false;
    if (!endsAt) return;
    const endsMs = Date.parse(endsAt);
    if (!Number.isFinite(endsMs)) return;

    const fire = () => {
      if (refreshedForDeadline.current) return;
      if (document.hidden) return;
      refreshedForDeadline.current = true;
      router.refresh();
    };

    const remaining = endsMs - Date.now();
    if (remaining <= 0) {
      const id = window.setTimeout(fire, 0);
      return () => window.clearTimeout(id);
    }

    const id = window.setTimeout(fire, remaining + 250);
    return () => window.clearTimeout(id);
  }, [endsAt, router]);

  return null;
}

function nearestFutureEndsAtMs(
  endsAtList: Array<string | null | undefined>,
): number | null {
  const now = Date.now();
  let nearest: number | null = null;
  for (const raw of endsAtList) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    if (ms < now - 5_000) continue;
    if (nearest == null || ms < nearest) nearest = ms;
  }
  return nearest;
}
