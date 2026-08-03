"use client";

import { useCallback, useEffect, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";

/**
 * Fetches trusted First Thirty status (read-only, no row invent).
 * Failures leave progress null — callers must not invent zero progress.
 *
 * While loading for the current auth key, progress stays null so surfaces
 * never flash a fake checklist. Loading is derived (key mismatch), not
 * optimistic milestone state.
 */
export function useFirstThirtyProgress(enabled = true): {
  progress: SafeFirstThirtyProgress | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
} {
  const { authenticated, registered, getAuthHeaders, privyReady } =
    useFennAuth();
  const canFetch = Boolean(enabled && authenticated && registered);
  const fetchKey = canFetch ? "active" : "";

  const [resolvedKey, setResolvedKey] = useState("");
  const [progress, setProgress] = useState<SafeFirstThirtyProgress | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    if (!canFetch) {
      return { ok: false as const, progress: null, failed: false };
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      return { ok: false as const, progress: null, failed: true };
    }
    try {
      const response = await fetch("/api/first-thirty", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        return { ok: false as const, progress: null, failed: true };
      }
      const data = (await response.json()) as {
        firstThirty?: SafeFirstThirtyProgress;
      };
      return {
        ok: true as const,
        progress: data.firstThirty ?? null,
        failed: false,
      };
    } catch {
      return { ok: false as const, progress: null, failed: true };
    }
  }, [canFetch, getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || !canFetch) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await load();
      if (cancelled) return;
      setProgress(result.progress);
      setFailed(result.failed);
      setResolvedKey(fetchKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [privyReady, canFetch, fetchKey, load, nonce]);

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    const result = await load();
    setProgress(result.progress);
    setFailed(result.failed);
    setResolvedKey(fetchKey);
    setNonce((n) => n + 1);
  }, [canFetch, fetchKey, load]);

  // Key mismatch ⇒ still loading for this credentials; never expose stale progress.
  const loading = Boolean(privyReady && canFetch && resolvedKey !== fetchKey);
  const visibleProgress =
    canFetch && resolvedKey === fetchKey ? progress : null;
  const visibleFailed =
    canFetch && resolvedKey === fetchKey && failed && !loading;

  return {
    progress: visibleProgress,
    loading,
    failed: visibleFailed,
    refresh,
  };
}
