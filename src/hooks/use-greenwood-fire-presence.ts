"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import {
  fetchGreenwoodPresence,
  postGreenwoodPresenceHeartbeat,
  postGreenwoodPresenceLeave,
  postGreenwoodPresenceSit,
} from "@/lib/greenwood/client";
import { GREENWOOD_FIRE_HEARTBEAT_MS } from "@/lib/greenwood/presence/constants";
import type { FirePresenceSnapshot } from "@/lib/greenwood/presence/types";
import { WORLD_PULSE_GREENWOOD_FIRE_MS } from "@/lib/world-pulse/intervals";

type UseGreenwoodFirePresenceOptions = {
  getAuthHeaders: () => Promise<HeadersInit | null>;
  enabled?: boolean;
};

type PresenceUiState = {
  status: "loading" | "ready" | "error";
  presence: FirePresenceSnapshot | null;
  actionPending: boolean;
};

const EMPTY_PRESENCE: FirePresenceSnapshot = {
  self: { present: false, sitting: false },
  activeCount: 0,
  members: [],
};

/**
 * Fire presence: visibility-aware heartbeat + quiet list refresh.
 * No full-page reload. No Realtime.
 */
export function useGreenwoodFirePresence({
  getAuthHeaders,
  enabled = true,
}: UseGreenwoodFirePresenceOptions) {
  const [state, setState] = useState<PresenceUiState>({
    status: "loading",
    presence: null,
    actionPending: false,
  });
  const getAuthHeadersRef = useRef(getAuthHeaders);
  const actionInFlight = useRef(false);

  useEffect(() => {
    getAuthHeadersRef.current = getAuthHeaders;
  }, [getAuthHeaders]);

  const refreshPresence = useCallback(async () => {
    const headers = await getAuthHeadersRef.current();
    if (!headers) {
      setState((prev) => ({
        ...prev,
        status: "error",
        presence: null,
      }));
      return;
    }

    const result = await fetchGreenwoodPresence(headers);
    if (!result.ok) {
      setState((prev) => ({
        ...prev,
        status: "error",
        // Fail closed: do not keep a stale inhabited list.
        presence: null,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: "ready",
      presence: result.presence,
    }));
  }, []);

  const heartbeat = useCallback(async () => {
    const headers = await getAuthHeadersRef.current();
    if (!headers) return;
    await postGreenwoodPresenceHeartbeat(headers);
  }, []);

  const pulseHeartbeat = useCallback(() => {
    void heartbeat();
  }, [heartbeat]);

  const pulsePresence = useCallback(() => {
    void refreshPresence();
  }, [refreshPresence]);

  usePagePulse({
    intervalMs: GREENWOOD_FIRE_HEARTBEAT_MS,
    onPulse: pulseHeartbeat,
    enabled,
    refreshOnVisible: true,
  });

  usePagePulse({
    intervalMs: WORLD_PULSE_GREENWOOD_FIRE_MS,
    onPulse: pulsePresence,
    enabled,
    refreshOnVisible: true,
  });

  // Immediate first heartbeat + list load when the Fire mounts.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        await heartbeat();
        if (cancelled) return;
        await refreshPresence();
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, heartbeat, refreshPresence]);

  const sit = useCallback(async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setState((prev) => ({ ...prev, actionPending: true }));
    try {
      const headers = await getAuthHeadersRef.current();
      if (!headers) return;
      const result = await postGreenwoodPresenceSit(headers);
      if (result.ok) {
        setState((prev) => ({
          ...prev,
          presence: prev.presence
            ? {
                ...prev.presence,
                self: result.self,
              }
            : {
                ...EMPTY_PRESENCE,
                self: result.self,
              },
        }));
        await refreshPresence();
      }
    } finally {
      actionInFlight.current = false;
      setState((prev) => ({ ...prev, actionPending: false }));
    }
  }, [refreshPresence]);

  const leave = useCallback(async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setState((prev) => ({ ...prev, actionPending: true }));
    try {
      const headers = await getAuthHeadersRef.current();
      if (!headers) return;
      const result = await postGreenwoodPresenceLeave(headers);
      if (result.ok) {
        setState((prev) => ({
          ...prev,
          presence: prev.presence
            ? {
                ...prev.presence,
                self: result.self,
              }
            : {
                ...EMPTY_PRESENCE,
                self: result.self,
              },
        }));
        await refreshPresence();
      }
    } finally {
      actionInFlight.current = false;
      setState((prev) => ({ ...prev, actionPending: false }));
    }
  }, [refreshPresence]);

  return {
    status: state.status,
    presence: state.presence,
    actionPending: state.actionPending,
    sit,
    leave,
  };
}
