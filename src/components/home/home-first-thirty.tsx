"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { FirstThirtyJourney } from "@/components/first-thirty/first-thirty-journey";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import { shouldShowFirstThirtyJourneySurface } from "@/lib/first-thirty/presentation";

/**
 * Homepage YOUR JOURNEY block — registered Outlaws only, above the map.
 * Uses shared bootstrap First Thirty snapshot (no separate waterfall).
 * Map never waits on this component's private data.
 */
export function HomeFirstThirty() {
  const {
    privyReady,
    authenticated,
    registered,
    profile,
    profileResolved,
    loading: authLoading,
  } = useFennAuth();

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

  // Known non-journey audiences: no reserved space (avoids empty band for public visitors).
  if (privyReady && profileResolved && !showSurface) {
    return null;
  }

  if (!authenticated && privyReady && !authLoading) {
    return null;
  }

  // Resolving authenticated session — stable reserved region so map doesn't jump.
  if (
    authenticated &&
    (authLoading || !profileResolved || (showSurface && loading && !progress && !failed))
  ) {
    return (
      <div
        className="home-section home-first-thirty home-first-thirty--stable"
        aria-busy="true"
      >
        <FirstThirtyJourney
          progress={null}
          loading
          failed={false}
          surface="home"
        />
      </div>
    );
  }

  if (!showSurface) {
    return null;
  }

  return (
    <div className="home-section home-first-thirty home-first-thirty--stable">
      <FirstThirtyJourney
        progress={progress}
        loading={loading}
        failed={failed}
        surface="home"
      />
    </div>
  );
}
