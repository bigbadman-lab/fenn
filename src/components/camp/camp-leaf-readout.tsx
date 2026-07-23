"use client";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatOutlawNumber } from "@/lib/profiles/types";

/**
 * Terminal LEAF readout from FennAuth profile cache only.
 * No ledger fetch, no mutation, no invented balance.
 */
export function CampLeafReadout() {
  const {
    privyReady,
    authenticated,
    loading,
    profileLoading,
    profileResolved,
    registered,
    profile,
  } = useFennAuth();

  if (!privyReady || !authenticated) {
    return (
      <div className="camp-readout" aria-live="polite">
        <p className="camp-readout__line">
          LEAF: <span className="muted">—</span>
        </p>
      </div>
    );
  }

  if (loading || profileLoading || !profileResolved) {
    return (
      <div className="camp-readout" aria-live="polite">
        <p className="camp-readout__line">
          LEAF: <span className="muted">checking...</span>
        </p>
      </div>
    );
  }

  if (!registered || !profile) {
    return (
      <div className="camp-readout" aria-live="polite">
        <p className="camp-readout__line muted">not yet written in the register.</p>
        <p className="camp-readout__line">
          LEAF: <span className="camp-leaf">0</span>
        </p>
      </div>
    );
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
