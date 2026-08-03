"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { FirstThirtyJourney } from "@/components/first-thirty/first-thirty-journey";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import { shouldShowFirstThirtyJourneySurface } from "@/lib/first-thirty/presentation";

/**
 * Homepage YOUR JOURNEY block — registered Outlaws only, above the map.
 * No celebrations; trusted GET status only.
 */
export function HomeFirstThirty() {
  const {
    privyReady,
    authenticated,
    registered,
    profile,
    loading: authLoading,
  } = useFennAuth();

  const greenwoodMember = Boolean(profile?.greenwoodEnteredAt);
  const showSurface = shouldShowFirstThirtyJourneySurface({
    authenticated,
    registered,
    greenwoodMember,
  });

  const { progress, loading, failed } = useFirstThirtyProgress(showSurface);

  // Unauthenticated / not registered / Greenwood member: nothing.
  if (!privyReady || authLoading) {
    return null;
  }
  if (!showSurface) {
    return null;
  }

  return (
    <div className="home-section home-first-thirty">
      <FirstThirtyJourney
        progress={progress}
        loading={loading}
        failed={failed}
        surface="home"
      />
    </div>
  );
}
