"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { OutlawRegisterPanel } from "@/components/outlaw/outlaw-register-panel";
import {
  HOMEPAGE_OUTLAW_THRESHOLD,
  resolveHomepageAudience,
  shouldShowOutlawThresholdIntro,
} from "@/lib/home/homepage-audience";

/**
 * Outlaw threshold — registration for strangers; profile for the named.
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
  // Registered: panel becomes identity readout — keep a quieter heading.
  const title =
    audience === "outlaw" || audience === "greenwood"
      ? "THE OUTLAW REGISTER"
      : HOMEPAGE_OUTLAW_THRESHOLD.title;

  return (
    <section
      id="outlaw-register"
      className="home-section home-register"
      aria-labelledby="outlaw-register-title"
    >
      <h2 id="outlaw-register-title" className="place__title">
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
