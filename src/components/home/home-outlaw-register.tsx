"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { OutlawRegisterPanel } from "@/components/outlaw/outlaw-register-panel";
import {
  HOMEPAGE_OUTLAW_THRESHOLD,
  resolveHomepageAudience,
  shouldShowOutlawThresholdIntro,
} from "@/lib/home/homepage-audience";
import { NAMED_DISPLAY, REGISTER_ANCHOR_ID } from "@/lib/site/world-vocabulary";

/**
 * Register threshold — name claim for strangers; profile for the Named.
 * Placed after the map so wanderers can explore first, with top CTA anchor.
 */
export function HomeOutlawRegister() {
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

  const showIntro = shouldShowOutlawThresholdIntro(audience);
  const isClaimTitle =
    audience !== "outlaw" && audience !== "greenwood";
  const title = isClaimTitle
    ? HOMEPAGE_OUTLAW_THRESHOLD.title
    : NAMED_DISPLAY.registerTitle;

  return (
    <section
      id={REGISTER_ANCHOR_ID}
      className="home-section home-register"
      aria-labelledby="register-title"
    >
      <h2
        id="register-title"
        className={
          isClaimTitle
            ? "place__title home-register__title home-register__title--become"
            : "place__title home-register__title"
        }
      >
        {title}
      </h2>

      {showIntro ? (
        <div className="home-register__intro place__body">
          {HOMEPAGE_OUTLAW_THRESHOLD.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <div className="home-register__wallet muted">
            {HOMEPAGE_OUTLAW_THRESHOLD.wallet.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}

      <OutlawRegisterPanel embedded />
    </section>
  );
}
