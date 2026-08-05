"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  HOMEPAGE_ACTIONS,
  HOMEPAGE_BEGIN_HERE,
  HOMEPAGE_GREENWOOD_TOP,
  HOMEPAGE_OUTLAW_TOP,
  HOMEPAGE_STRANGER_LINES,
  homepageGreetingTitle,
  resolveHomepageAudience,
  shouldShowBecomeOutlawCta,
  shouldShowBeginHere,
  shouldShowExploreMapCta,
} from "@/lib/home/homepage-audience";

/**
 * Audience-aware arrival orientation.
 * Deterministic stranger path while Privy is not ready (SSR match).
 * Pending never prints the wrong greeting or Outlaw-only CTAs.
 */
export function HomeWelcome() {
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

  const title = homepageGreetingTitle(audience);
  const showBecome = shouldShowBecomeOutlawCta(audience);
  const showExplore = shouldShowExploreMapCta(audience);
  const showBegin = shouldShowBeginHere(audience);

  return (
    <section
      className="home-section home-welcome"
      aria-label="welcome"
      aria-busy={audience === "pending" ? true : undefined}
    >
      {title ? (
        <h2 className="home-welcome__title">{title}</h2>
      ) : (
        <h2 className="home-welcome__title home-welcome__title--pending muted">
          …
        </h2>
      )}

      {audience === "pending" ? (
        <p className="home-welcome__line muted">the wood is reading the road…</p>
      ) : null}

      {audience === "stranger" ? (
        <>
          <div className="home-welcome__body">
            {HOMEPAGE_STRANGER_LINES.lead.map((line) => (
              <p key={line} className="home-welcome__line">
                {line}
              </p>
            ))}
          </div>
          <div className="home-welcome__body">
            <p className="home-welcome__line">
              Do{" "}
              <Link href="/deeds" className="home-welcome__inline-link">
                deeds
              </Link>
              . Speak in{" "}
              <Link href="/camp" className="home-welcome__inline-link">
                Camp
              </Link>
              . Earn LEAF.
            </p>
            <p className="home-welcome__line">
              When FENN is satisfied, the{" "}
              <Link href="/greenwood" className="home-welcome__inline-link">
                Greenwood
              </Link>{" "}
              opens.
            </p>
          </div>
          <p className="home-welcome__closing">
            {HOMEPAGE_STRANGER_LINES.closing}
          </p>
        </>
      ) : null}

      {audience === "outlaw" ? (
        <div className="home-welcome__body">
          {HOMEPAGE_OUTLAW_TOP.lines.map((line) => (
            <p key={line} className="home-welcome__line">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {audience === "greenwood" ? (
        <div className="home-welcome__body">
          {HOMEPAGE_GREENWOOD_TOP.lines.map((line) => (
            <p key={line} className="home-welcome__line">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {showBegin ? (
        <div className="home-welcome__begin" aria-label="begin here">
          <h3 className="home-welcome__begin-title">
            {HOMEPAGE_BEGIN_HERE.title}
          </h3>
          <div className="home-welcome__body">
            {HOMEPAGE_BEGIN_HERE.lines.map((line) => (
              <p key={line} className="home-welcome__line">
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {showBecome || showExplore ? (
        <p className="home-welcome__cta">
          {showBecome ? (
            <a
              href={`#${HOMEPAGE_ACTIONS.outlawThresholdId}`}
              className="home-welcome__action home-welcome__action--become"
            >
              {HOMEPAGE_ACTIONS.becomeOutlaw}
            </a>
          ) : null}
          {showExplore ? (
            <a
              href={`#${HOMEPAGE_ACTIONS.mapId}`}
              className="home-welcome__action"
            >
              {HOMEPAGE_ACTIONS.exploreMap}
            </a>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
