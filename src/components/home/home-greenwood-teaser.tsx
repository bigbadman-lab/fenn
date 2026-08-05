"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { resolveHomepageAudience } from "@/lib/home/homepage-audience";

/**
 * Greenwood desire object for strangers / Outlaws.
 * Members see a restrained open-home path instead of "not opened" copy.
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
        className="home-section home-greenwood"
        aria-labelledby="home-greenwood-title"
      >
        <h2 id="home-greenwood-title" className="place__title">
          THE GREENWOOD
        </h2>
        <div className="place__body">
          <p>you already walk this wood.</p>
          <p className="muted">return when the road calls you back.</p>
          <p>
            <Link href="/greenwood?crossing=1">[ walk to the greenwood ]</Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="home-section home-greenwood"
      aria-labelledby="home-greenwood-title"
    >
      <h2 id="home-greenwood-title" className="place__title">
        THE GREENWOOD
      </h2>
      <div className="place__body">
        <p>the path continues beyond this point.</p>
        <p>access is earned — not sold.</p>
        <p className="home-greenwood__whisper muted">
          a door everyone can open isn&apos;t much of a door.
        </p>
        <p>
          <Link href="/greenwood?crossing=1">[ go to the greenwood ]</Link>
        </p>
      </div>
    </section>
  );
}
