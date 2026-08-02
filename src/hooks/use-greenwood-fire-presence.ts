"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useFirePresenceShell } from "@/components/shell/fire-presence-provider";
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
  actionError: string | null;
};

const EMPTY_PRESENCE: FirePresenceSnapshot = {
  self: { present: false, sitting: false },
  activeCount: 0,
  members: [],
};

const ACTION_ERROR_COPY = "the Fire did not answer.";

/**
 * Fire presence list + sit/leave.
 * Heartbeat while seated is owned by FirePresenceProvider (shell).
 * This hook heartbeats only while mounted and not seated (warm nearby).
 */
export function useGreenwoodFirePresence({
  getAuthHeaders,
  enabled = true,
}: UseGreenwoodFirePresenceOptions) {
  const { seated, notifySitting } = useFirePresenceShell();
  const [state, setState] = useState<PresenceUiState>({
    status: "loading",
    presence: null,
    actionPending: false,
    actionError: null,
  });
  const getAuthHeadersRef = useRef(getAuthHeaders);
  const seatedRef = useRef(seated);
  const actionInFlight = useRef(false);

  useEffect(() => {
    getAuthHeadersRef.current = getAuthHeaders;
  }, [getAuthHeaders]);

  useEffect(() => {
    seatedRef.current = seated;
  }, [seated]);

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
        presence: null,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: "ready",
      presence: result.presence,
      actionError: null,
    }));
    notifySitting(result.presence.self.sitting);
  }, [notifySitting]);

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

  // Warm-nearby heartbeat only — seated heartbeat lives in the shell provider.
  usePagePulse({
    intervalMs: GREENWOOD_FIRE_HEARTBEAT_MS,
    onPulse: pulseHeartbeat,
    enabled: enabled && !seated,
    refreshOnVisible: true,
  });

  usePagePulse({
    intervalMs: WORLD_PULSE_GREENWOOD_FIRE_MS,
    onPulse: pulsePresence,
    enabled,
    refreshOnVisible: true,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        // Shell owns heartbeat while seated; warm-nearby only here.
        if (!seatedRef.current) {
          await heartbeat();
        }
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
    setState((prev) => ({
      ...prev,
      actionPending: true,
      actionError: null,
    }));
    try {
      const headers = await getAuthHeadersRef.current();
      if (!headers) {
        setState((prev) => ({ ...prev, actionError: ACTION_ERROR_COPY }));
        return;
      }
      const result = await postGreenwoodPresenceSit(headers);
      if (!result.ok) {
        setState((prev) => ({ ...prev, actionError: ACTION_ERROR_COPY }));
        return;
      }
      notifySitting(true);
      setState((prev) => ({
        ...prev,
        actionError: null,
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
    } finally {
      actionInFlight.current = false;
      setState((prev) => ({ ...prev, actionPending: false }));
    }
  }, [notifySitting, refreshPresence]);

  const leave = useCallback(async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setState((prev) => ({
      ...prev,
      actionPending: true,
      actionError: null,
    }));
    try {
      const headers = await getAuthHeadersRef.current();
      if (!headers) {
        setState((prev) => ({ ...prev, actionError: ACTION_ERROR_COPY }));
        return;
      }
      const result = await postGreenwoodPresenceLeave(headers);
      if (!result.ok) {
        setState((prev) => ({ ...prev, actionError: ACTION_ERROR_COPY }));
        return;
      }
      notifySitting(false);
      setState((prev) => ({
        ...prev,
        actionError: null,
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
    } finally {
      actionInFlight.current = false;
      setState((prev) => ({ ...prev, actionPending: false }));
    }
  }, [notifySitting, refreshPresence]);

  return {
    status: state.status,
    presence: state.presence,
    actionPending: state.actionPending,
    actionError: state.actionError,
    sit,
    leave,
  };
}
