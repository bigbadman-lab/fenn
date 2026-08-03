"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { OutlawInviteMemberSummary } from "@/lib/invites/types";

/**
 * Invite summary for /outlaw.
 * Initial paint from bootstrap; no immediate duplicate /api/invites/me when seeded.
 *
 * Freshness: bootstrap first; explicit refresh() only; soft failures keep last summary.
 */
export function useOutlawInviteSummary(): {
  invite: OutlawInviteMemberSummary | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
} {
  const {
    registered,
    profileResolved,
    getAuthHeaders,
    bootstrapGeneration,
    inviteSnapshot,
    inviteBootstrapFailed,
  } = useFennAuth();

  const canUse = Boolean(registered);

  const bootstrapSeed = useMemo(() => {
    if (!canUse || !profileResolved) return null;
    return {
      invite: inviteSnapshot,
      failed: Boolean(inviteBootstrapFailed && inviteSnapshot == null),
    };
  }, [canUse, profileResolved, inviteSnapshot, inviteBootstrapFailed]);

  const [remoteInvite, setRemoteInvite] =
    useState<OutlawInviteMemberSummary | null>(null);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [remoteGeneration, setRemoteGeneration] = useState<number | null>(
    null,
  );
  const [remotePending, setRemotePending] = useState(false);
  const [preferRemoteGeneration, setPreferRemoteGeneration] = useState<
    number | null
  >(null);

  const loadRemote = useCallback(async (): Promise<{
    invite: OutlawInviteMemberSummary | null;
    failed: boolean;
  }> => {
    const headers = await getAuthHeaders();
    if (!headers) {
      return { invite: null, failed: true };
    }
    try {
      const response = await fetch("/api/invites/me", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        return { invite: null, failed: true };
      }
      const data = (await response.json()) as {
        invite?: OutlawInviteMemberSummary;
      };
      return { invite: data.invite ?? null, failed: false };
    } catch {
      return { invite: null, failed: true };
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!canUse || !profileResolved) return;
    if (bootstrapSeed) return;
    if (remoteGeneration === bootstrapGeneration) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemotePending(true);
      void (async () => {
        const result = await loadRemote();
        if (cancelled) return;
        if (!result.failed) {
          setRemoteInvite(result.invite);
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
    canUse,
    profileResolved,
    bootstrapSeed,
    remoteGeneration,
    bootstrapGeneration,
    loadRemote,
  ]);

  const refresh = useCallback(async () => {
    if (!canUse) return;
    setRemotePending(true);
    const result = await loadRemote();
    setPreferRemoteGeneration(bootstrapGeneration);
    if (!result.failed) {
      setRemoteInvite(result.invite);
      setRemoteFailed(false);
    } else {
      setRemoteFailed((prev) => prev || remoteInvite == null);
    }
    setRemoteGeneration(bootstrapGeneration);
    setRemotePending(false);
  }, [canUse, loadRemote, remoteInvite, bootstrapGeneration]);

  const useRemote = preferRemoteGeneration === bootstrapGeneration;

  const invite = !canUse
    ? null
    : useRemote
      ? remoteInvite
      : bootstrapSeed
        ? bootstrapSeed.invite
        : remoteGeneration === bootstrapGeneration
          ? remoteInvite
          : null;

  const failed = !canUse
    ? false
    : useRemote
      ? remoteFailed && remoteInvite == null
      : bootstrapSeed
        ? bootstrapSeed.failed
        : remoteGeneration === bootstrapGeneration
          ? remoteFailed && remoteInvite == null
          : false;

  const loading = Boolean(
    canUse &&
      (remotePending ||
        !profileResolved ||
        (!bootstrapSeed && remoteGeneration !== bootstrapGeneration)),
  );

  return {
    invite: loading && !invite ? null : invite,
    loading,
    failed: failed && !loading,
    refresh,
  };
}
