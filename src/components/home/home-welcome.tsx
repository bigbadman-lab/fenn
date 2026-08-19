"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  HOMEPAGE_ACTIONS,
  HOMEPAGE_BEGIN_HERE,
  HOMEPAGE_GREENWOOD_TOP,
  HOMEPAGE_OUTLAW_TOP,
  HOMEPAGE_PENDING_LINE,
  HOMEPAGE_STRANGER_LINES,
  homepageGreetingTitle,
  resolveHomepageAudience,
  shouldShowBecomeOutlawCta,
  shouldShowBeginHere,
  shouldShowExploreMapCta,
} from "@/lib/home/homepage-audience";
import { CANOPY_DISPLAY, CANOPY_PATH } from "@/lib/site/world-vocabulary";

/**
 * Audience-aware arrival orientation.
 * Deterministic stranger path while Privy is not ready (SSR match).
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
      className="home-section home-arrival home-welcome"
      aria-label="welcome"
      aria-busy={audience === "pending" ? true : undefined}
    >
      <div className="home-arrival__frame">
        <header className="home-arrival__header">
          <p className="home-arrival__kicker">signal // arrival</p>
          {title ? (
            <h2 className="home-arrival__title home-welcome__title">{title}</h2>
          ) : (
            <h2 className="home-arrival__title home-welcome__title home-welcome__title--pending muted">
              …
            </h2>
          )}
        </header>

        <div className="home-arrival__content">
          {audience === "pending" ? (
            <p className="home-arrival__pending home-welcome__line muted">
              {HOMEPAGE_PENDING_LINE}
            </p>
          ) : null}

          {audience === "stranger" ? (
            <>
              <div className="home-arrival__panel home-welcome__body">
                {HOMEPAGE_STRANGER_LINES.lead.map((line) => (
                  <p key={line} className="home-welcome__line">
                    {line}
                  </p>
                ))}
              </div>
              <div className="home-arrival__panel home-welcome__body">
                <p className="home-welcome__line">
                  Take on{" "}
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
                  When VELL is satisfied,{" "}
                  <Link href={CANOPY_PATH} className="home-welcome__inline-link">
                    {CANOPY_DISPLAY.the}
                  </Link>{" "}
                  opens.
                </p>
                <p className="home-welcome__line">
                  Public commitments live in the{" "}
                  <Link href="/commons" className="home-welcome__inline-link">
                    Commons
                  </Link>
                  .
                </p>
              </div>
              <p className="home-arrival__closing home-welcome__closing">
                {HOMEPAGE_STRANGER_LINES.closing}
              </p>
            </>
          ) : null}

          {audience === "outlaw" ? (
            <div className="home-arrival__panel home-welcome__body">
              {HOMEPAGE_OUTLAW_TOP.lines.map((line) => (
                <p key={line} className="home-welcome__line">
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {audience === "greenwood" ? (
            <div className="home-arrival__panel home-welcome__body">
              {HOMEPAGE_GREENWOOD_TOP.lines.map((line) => (
                <p key={line} className="home-welcome__line">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        {showBegin ? (
          <aside className="home-arrival__guide home-welcome__begin" aria-label="first steps">
            <h3 className="home-arrival__guide-title home-welcome__begin-title">
              {HOMEPAGE_BEGIN_HERE.title}
            </h3>
            <div className="home-welcome__body">
              {HOMEPAGE_BEGIN_HERE.lines.map((line) => (
                <p key={line} className="home-welcome__line">
                  {line}
                </p>
              ))}
            </div>
          </aside>
        ) : null}

        {showBecome || showExplore ? (
          <footer className="home-arrival__actions home-welcome__cta">
            {showBecome ? (
              <a
                href={`#${HOMEPAGE_ACTIONS.outlawThresholdId}`}
                className="home-arrival__action home-welcome__action home-welcome__action--become"
              >
                {HOMEPAGE_ACTIONS.becomeOutlaw}
              </a>
            ) : null}
            {showExplore ? (
              <a
                href={`#${HOMEPAGE_ACTIONS.mapId}`}
                className="home-arrival__action home-welcome__action"
              >
                {HOMEPAGE_ACTIONS.exploreMap}
              </a>
            ) : null}
          </footer>
        ) : null}
      </div>
    </section>
  );
}
