"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { shouldShowCampLeafReadout } from "@/lib/camp/leaf-readout-visibility";
import { formatOutlawNumber } from "@/lib/profiles/types";

/**
 * Terminal LEAF readout from FennAuth profile cache only.
 * No ledger fetch, no mutation, no invented balance.
 * Hidden for guests and until a registered Outlaw profile is resolved.
 */
export function CampLeafReadout() {
  const {
    privyReady,
    authenticated,
    profileResolved,
    registered,
    profile,
  } = useFennAuth();

  if (
    !shouldShowCampLeafReadout({
      privyReady,
      authenticated,
      profileResolved,
      registered,
      hasProfile: Boolean(profile),
    }) ||
    !profile
  ) {
    return null;
  }

  return (
    <div className="camp-readout" aria-live="polite">
      <p className="camp-readout__line">
        OUTLAW {formatOutlawNumber(profile.outlawNumber)}
      </p>
      <p className="camp-readout__line">
        LEAF: <span className="camp-leaf">{profile.leafBalance}</span>
      </p>
    </div>
  );
}
