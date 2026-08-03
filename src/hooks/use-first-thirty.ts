"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";

export type UseFirstThirtyProgressOptions = {
  enabled?: boolean;
  /**
   * When true (default), use bootstrap snapshot and skip immediate
   * /api/first-thirty when a trusted seed is available.
   */
  useBootstrapSnapshot?: boolean;
};

/**
 * Trusted First Thirty status (read-only, no row invent).
 * Never invents zero progress.
 *
 * Freshness policy:
 * - Initial paint: bootstrap snapshot when available.
 * - No immediate duplicate GET when bootstrap seeded.
 * - Explicit refresh() hits GET /api/first-thirty.
 * - Soft refresh failure preserves last trusted progress.
 */
export function useFirstThirtyProgress(
  enabledOrOptions: boolean | UseFirstThirtyProgressOptions = true,
): {
  progress: SafeFirstThirtyProgress | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
} {
  const options: UseFirstThirtyProgressOptions =
    typeof enabledOrOptions === "boolean"
      ? { enabled: enabledOrOptions, useBootstrapSnapshot: true }
      : {
          enabled: enabledOrOptions.enabled ?? true,
          useBootstrapSnapshot: enabledOrOptions.useBootstrapSnapshot ?? true,
        };

  const enabled = options.enabled !== false;
  const useBootstrap = options.useBootstrapSnapshot !== false;

  const {
    authenticated,
    registered,
    getAuthHeaders,
    privyReady,
    profileResolved,
    bootstrapGeneration,
    firstThirtySnapshot,
    firstThirtyBootstrapFailed,
  } = useFennAuth();

  const canFetch = Boolean(enabled && authenticated && registered);

  const bootstrapSeed = useMemo(() => {
    if (!useBootstrap || !canFetch || !profileResolved) return null;
    return {
      progress: firstThirtySnapshot,
      failed: Boolean(firstThirtyBootstrapFailed && firstThirtySnapshot == null),
    };
  }, [
    useBootstrap,
    canFetch,
    profileResolved,
    firstThirtySnapshot,
    firstThirtyBootstrapFailed,
  ]);

  const [remoteProgress, setRemoteProgress] =
    useState<SafeFirstThirtyProgress | null>(null);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [remoteGeneration, setRemoteGeneration] = useState<number | null>(
    null,
  );
  const [remotePending, setRemotePending] = useState(false);
  const [preferRemoteGeneration, setPreferRemoteGeneration] = useState<
    number | null
  >(null);

  const loadRemote = useCallback(async (): Promise<{
    progress: SafeFirstThirtyProgress | null;
    failed: boolean;
  }> => {
    const headers = await getAuthHeaders();
    if (!headers) {
      return { progress: null, failed: true };
    }
    try {
      const response = await fetch("/api/first-thirty", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        return { progress: null, failed: true };
      }
      const data = (await response.json()) as {
        firstThirty?: SafeFirstThirtyProgress;
      };
      return { progress: data.firstThirty ?? null, failed: false };
    } catch {
      return { progress: null, failed: true };
    }
  }, [getAuthHeaders]);

  // Fallback remote load when bootstrap seed is unavailable.
  useEffect(() => {
    if (!privyReady || !canFetch) return;
    if (bootstrapSeed) return;
    if (useBootstrap && !profileResolved) return;
    if (remoteGeneration === bootstrapGeneration) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemotePending(true);
      void (async () => {
        const result = await loadRemote();
        if (cancelled) return;
        if (!result.failed) {
          setRemoteProgress(result.progress);
          setRemoteFailed(false);
        } else {
          setRemoteFailed(true);
        }
        setRemoteGeneration(bootstrapGeneration);
        setRemotePending(false);
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    privyReady,
    canFetch,
    bootstrapSeed,
    useBootstrap,
    profileResolved,
    remoteGeneration,
    bootstrapGeneration,
    loadRemote,
  ]);

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    setRemotePending(true);
    const result = await loadRemote();
    setPreferRemoteGeneration(bootstrapGeneration);
    if (!result.failed) {
      setRemoteProgress(result.progress);
      setRemoteFailed(false);
    } else {
      setRemoteFailed((prev) => prev || remoteProgress == null);
    }
    setRemoteGeneration(bootstrapGeneration);
    setRemotePending(false);
  }, [canFetch, loadRemote, remoteProgress, bootstrapGeneration]);

  const useRemote = preferRemoteGeneration === bootstrapGeneration;

  const progress = !canFetch
    ? null
    : useRemote
      ? remoteProgress
      : bootstrapSeed
        ? bootstrapSeed.progress
        : remoteGeneration === bootstrapGeneration
          ? remoteProgress
          : null;

  const failed = !canFetch
    ? false
    : useRemote
      ? remoteFailed && remoteProgress == null
      : bootstrapSeed
        ? bootstrapSeed.failed
        : remoteGeneration === bootstrapGeneration
          ? remoteFailed && remoteProgress == null
          : false;

  const loading = Boolean(
    canFetch &&
      privyReady &&
      (remotePending ||
        (useBootstrap && !profileResolved) ||
        (!bootstrapSeed && remoteGeneration !== bootstrapGeneration)),
  );

  return {
    progress: loading && !progress ? null : progress,
    loading,
    failed: failed && !loading,
    refresh,
  };
}
