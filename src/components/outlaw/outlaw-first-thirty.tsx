"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { FirstThirtyJourney } from "@/components/first-thirty/first-thirty-journey";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import { shouldShowFirstThirtyJourneySurface } from "@/lib/first-thirty/presentation";

/**
 * Personal journey record on /outlaw — after identity, before account LEAF block.
 */
export function OutlawFirstThirty() {
  const { authenticated, registered, profile } = useFennAuth();
  const greenwoodMember = Boolean(profile?.greenwoodEnteredAt);
  const showSurface = shouldShowFirstThirtyJourneySurface({
    authenticated,
    registered,
    greenwoodMember,
  });

  const { progress, loading, failed } = useFirstThirtyProgress(showSurface);

  if (!showSurface) {
    return null;
  }

  return (
    <FirstThirtyJourney
      progress={progress}
      loading={loading}
      failed={failed}
      surface="outlaw"
    />
  );
}
