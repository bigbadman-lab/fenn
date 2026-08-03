"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { FirstThirtyJourney } from "@/components/first-thirty/first-thirty-journey";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import { shouldShowFirstThirtyJourneySurface } from "@/lib/first-thirty/presentation";

/**
 * Personal journey record on /outlaw — after identity, before invite.
 * Uses shared bootstrap First Thirty snapshot.
 */
export function OutlawFirstThirty() {
  const { authenticated, registered, profile, loading: authLoading } =
    useFennAuth();
  const greenwoodMember = Boolean(profile?.greenwoodEnteredAt);
  const showSurface = shouldShowFirstThirtyJourneySurface({
    authenticated,
    registered,
    greenwoodMember,
  });

  const { progress, loading, failed } = useFirstThirtyProgress({
    enabled: showSurface,
    useBootstrapSnapshot: true,
  });

  if (!showSurface) {
    return null;
  }

  return (
    <div className="outlaw-ft-region">
      <FirstThirtyJourney
        progress={progress}
        loading={authLoading || loading}
        failed={failed}
        surface="outlaw"
      />
    </div>
  );
}
