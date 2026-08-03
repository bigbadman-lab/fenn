"use client";

import { useCallback, useEffect, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";

/**
 * Fetches trusted First Thirty status (read-only, no row invent).
 * Failures leave progress null — callers should not fake onboarding.
 */
export function useFirstThirtyProgress(enabled = true): {
  progress: SafeFirstThirtyProgress | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { authenticated, registered, getAuthHeaders, privyReady } =
    useFennAuth();
  const [progress, setProgress] = useState<SafeFirstThirtyProgress | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !authenticated || !registered) {
      setProgress(null);
      return;
    }
    const headers = await getAuthHeaders();
    if (!headers) {
      setProgress(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/first-thirty", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        setProgress(null);
        return;
      }
      const data = (await response.json()) as {
        firstThirty?: SafeFirstThirtyProgress;
      };
      setProgress(data.firstThirty ?? null);
    } catch {
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }, [authenticated, enabled, getAuthHeaders, registered]);

  useEffect(() => {
    if (!privyReady || !enabled) return;
    const t = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(t);
  }, [privyReady, enabled, refresh]);

  return { progress, loading, refresh };
}
