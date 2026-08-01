"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import {
  fetchGreenwoodGatherings,
  postLowerGatheringHand,
  postRaiseGatheringHand,
} from "@/lib/greenwood/client";
import type { FireGatheringsSnapshot } from "@/lib/greenwood/gatherings/types";
import { WORLD_PULSE_GREENWOOD_GATHERING_MS } from "@/lib/world-pulse/intervals";

type Options = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
  enabled?: boolean;
};

/**
 * Narrow Gathering refresh for The Fire.
 * Independent from presence; failures do not break the hub.
 */
export function useGreenwoodFireGatherings({
  getAuthHeaders,
  enabled = true,
}: Options) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [snapshot, setSnapshot] = useState<FireGatheringsSnapshot | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const headersRef = useRef(getAuthHeaders);
  const inFlight = useRef(false);

  useEffect(() => {
    headersRef.current = getAuthHeaders;
  }, [getAuthHeaders]);

  const refresh = useCallback(async () => {
    const headers = await headersRef.current();
    if (!headers) {
      setStatus("error");
      setSnapshot(null);
      return;
    }
    const result = await fetchGreenwoodGatherings(headers);
    if (!result.ok) {
      setStatus("error");
      setSnapshot(null);
      return;
    }
    setStatus("ready");
    setSnapshot(result.gatherings);
  }, []);

  usePagePulse({
    intervalMs: WORLD_PULSE_GREENWOOD_GATHERING_MS,
    onPulse: () => {
      void refresh();
    },
    enabled,
    refreshOnVisible: true,
  });

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, refresh]);

  const raiseHand = useCallback(
    async (gatheringId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setActionPending(true);
      try {
        const headers = await headersRef.current();
        if (!headers) return;
        const result = await postRaiseGatheringHand(gatheringId, headers);
        if (result.ok) {
          await refresh();
        }
      } finally {
        inFlight.current = false;
        setActionPending(false);
      }
    },
    [refresh],
  );

  const lowerHand = useCallback(
    async (gatheringId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setActionPending(true);
      try {
        const headers = await headersRef.current();
        if (!headers) return;
        const result = await postLowerGatheringHand(gatheringId, headers);
        if (result.ok) {
          await refresh();
        }
      } finally {
        inFlight.current = false;
        setActionPending(false);
      }
    },
    [refresh],
  );

  return {
    status,
    snapshot,
    actionPending,
    refresh,
    raiseHand,
    lowerHand,
  };
}
