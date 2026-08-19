"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { resolveHomepageAudience } from "@/lib/home/homepage-audience";
import { CANOPY_DISPLAY, CANOPY_PATH } from "@/lib/site/world-vocabulary";

/**
 * Canopy desire object for strangers / Named members.
 * Canopy members see a restrained open-home path instead of "not opened" copy.
 */
export function HomeGreenwoodTeaser() {
  const {
    privyReady,
    loading: authLoading,
    profileResolved,
    authenticated,
    registered,
    profile,
  } = useFennAuth();

  const audience = resolveHomepageAudience({
    privyReady,
    authLoading,
    profileResolved,
    authenticated,
    registered,
    greenwoodMember: Boolean(profile?.greenwoodEnteredAt),
  });

  if (audience === "greenwood") {
    return (
      <section
        className="home-section home-canopy"
        aria-labelledby="home-canopy-title"
      >
        <h2 id="home-canopy-title" className="place__title">
          {CANOPY_DISPLAY.title}
        </h2>
        <div className="place__body">
          <p>you already walk beneath it.</p>
          <p className="muted">return when the road calls you back.</p>
          <p>
            <Link href={CANOPY_PATH}>{CANOPY_DISPLAY.walkLink}</Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="home-section home-canopy"
      aria-labelledby="home-canopy-title"
    >
      <h2 id="home-canopy-title" className="place__title">
        {CANOPY_DISPLAY.title}
      </h2>
      <div className="place__body">
        <p>the path continues above the road.</p>
        <p>access is earned — not sold.</p>
        <p className="home-canopy__whisper muted">
          a door everyone can open isn&apos;t much of a door.
        </p>
        <p>
          <Link href={CANOPY_PATH}>{CANOPY_DISPLAY.goLink}</Link>
        </p>
      </div>
    </section>
  );
}
