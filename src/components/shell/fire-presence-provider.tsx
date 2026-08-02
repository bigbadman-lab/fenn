"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { usePagePulse } from "@/hooks/use-page-pulse";
import {
  fetchGreenwoodFireSelfStatus,
  postGreenwoodPresenceHeartbeat,
} from "@/lib/greenwood/client";
import { GREENWOOD_FIRE_HEARTBEAT_MS } from "@/lib/greenwood/presence/constants";
import { WORLD_PULSE_GREENWOOD_FIRE_MS } from "@/lib/world-pulse/intervals";

type FirePresenceShellValue = {
  /** Greenwood member with active seated lease. */
  seated: boolean;
  member: boolean;
  active: boolean;
  /** Immediate local update after trusted sit/leave. */
  notifySitting: (sitting: boolean) => void;
  refreshSelf: () => Promise<void>;
};

const FirePresenceShellContext =
  createContext<FirePresenceShellValue | null>(null);

const CLEARED = { member: false, active: false, sitting: false } as const;

/**
 * Owns cross-route Fire heartbeat while the member is seated.
 * Local AT THE FIRE hook heartbeats only when mounted and not seated.
 */
export function FirePresenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authenticated, registered, profile, getAuthHeaders, loading } =
    useFennAuth();
  const canTrackFire =
    !loading && authenticated && registered && Boolean(profile?.greenwoodEnteredAt);

  const [status, setStatus] = useState<{
    member: boolean;
    active: boolean;
    sitting: boolean;
  }>(CLEARED);

  const refreshSelf = useCallback(async () => {
    if (!canTrackFire) {
      setStatus(CLEARED);
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      setStatus(CLEARED);
      return;
    }
    const result = await fetchGreenwoodFireSelfStatus(headers);
    if (!result.ok) {
      setStatus(CLEARED);
      return;
    }
    setStatus({
      member: result.status.member,
      active: result.status.active,
      sitting: result.status.sitting,
    });
  }, [canTrackFire, getAuthHeaders]);

  const notifySitting = useCallback((next: boolean) => {
    setStatus((prev) =>
      next
        ? { member: true, active: true, sitting: true }
        : { ...prev, sitting: false },
    );
  }, []);

  useEffect(() => {
    if (!canTrackFire) {
      const timer = window.setTimeout(() => {
        setStatus(CLEARED);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      void refreshSelf();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canTrackFire, refreshSelf]);

  const seated = status.member && status.active && status.sitting;

  usePagePulse({
    intervalMs: WORLD_PULSE_GREENWOOD_FIRE_MS,
    onPulse: () => {
      void refreshSelf();
    },
    enabled: canTrackFire,
    refreshOnVisible: true,
  });

  usePagePulse({
    intervalMs: GREENWOOD_FIRE_HEARTBEAT_MS,
    onPulse: () => {
      void (async () => {
        const headers = await getAuthHeaders();
        if (!headers) return;
        const result = await postGreenwoodPresenceHeartbeat(headers);
        if (result.ok) {
          setStatus({
            member: true,
            active: result.self.present,
            sitting: result.self.sitting,
          });
        }
      })();
    },
    enabled: seated,
    refreshOnVisible: true,
  });

  const value = useMemo(
    () => ({
      seated,
      member: status.member,
      active: status.active,
      notifySitting,
      refreshSelf,
    }),
    [seated, status.member, status.active, notifySitting, refreshSelf],
  );

  return (
    <FirePresenceShellContext.Provider value={value}>
      {children}
    </FirePresenceShellContext.Provider>
  );
}

export function useFirePresenceShell(): FirePresenceShellValue {
  const ctx = useContext(FirePresenceShellContext);
  if (!ctx) {
    return {
      seated: false,
      member: false,
      active: false,
      notifySitting: () => {},
      refreshSelf: async () => {},
    };
  }
  return ctx;
}
