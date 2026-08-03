"use client";

import { useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { useOutlawInviteSummary } from "@/hooks/use-outlaw-invite";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * INVITE AN OUTLAW — registered member surface on /outlaw.
 * Renders from bootstrap snapshot; no mount-time invite waterfall.
 */
export function OutlawInvite() {
  const { registered, loading: authLoading } = useFennAuth();
  const { invite, loading, failed } = useOutlawInviteSummary();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  async function onCopy() {
    if (!invite?.inviteUrl) return;
    const ok = await copyText(invite.inviteUrl);
    setCopyState(ok ? "ok" : "fail");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  if (!registered) return null;

  if (authLoading || (loading && !invite && !failed)) {
    return (
      <section
        className="outlaw-invite outlaw-invite--stable"
        aria-label="Invite an Outlaw"
        aria-busy="true"
      >
        <p className="outlaw-invite__rule" aria-hidden>
          --------------------------------
        </p>
        <p className="muted">the road is being read...</p>
      </section>
    );
  }

  if (failed || !invite) {
    return (
      <section
        className="outlaw-invite outlaw-invite--stable"
        aria-labelledby="outlaw-invite-title"
      >
        <p className="outlaw-invite__rule" aria-hidden>
          --------------------------------
        </p>
        <h2 id="outlaw-invite-title" className="outlaw-invite__title">
          INVITE AN OUTLAW
        </h2>
        <p className="muted">the road cannot be copied just now.</p>
      </section>
    );
  }

  const capReached = invite.rewardedInvitesRemaining === 0;

  return (
    <section
      className="outlaw-invite outlaw-invite--stable"
      aria-labelledby="outlaw-invite-title"
    >
      <p className="outlaw-invite__rule" aria-hidden>
        --------------------------------
      </p>

      <h2 id="outlaw-invite-title" className="outlaw-invite__title">
        INVITE AN OUTLAW
      </h2>

      <div className="outlaw-invite__copy">
        <p>The Greenwood does not grow by accident.</p>
        <p>
          Bring another Outlaw to the road.
          <br />
          When they complete the Register,
          <br />
          five LEAF will be added to your name.
        </p>
      </div>

      <p className="outlaw-invite__policy">
        5 LEAF FOR EACH OUTLAW WHO ARRIVES
        <br />
        UP TO 10 REWARDED INVITES
      </p>

      <div className="outlaw-invite__actions">
        <button type="button" className="btn-text" onClick={() => void onCopy()}>
          [ COPY YOUR INVITE LINK ]
        </button>
        <p className="outlaw-invite__feedback" aria-live="polite">
          {copyState === "ok"
            ? "the road has been copied."
            : copyState === "fail"
              ? "the road could not be copied."
              : ""}
        </p>
      </div>

      <p className="outlaw-invite__url-label">your invite link:</p>
      <p className="outlaw-invite__url">
        <code className="outlaw-invite__url-text">{invite.inviteUrl}</code>
      </p>

      <p className="outlaw-invite__rule" aria-hidden>
        --------------------------------
      </p>

      <h3 className="outlaw-invite__summary-title">
        OUTLAWS YOU BROUGHT TO THE ROAD
      </h3>

      {capReached ? (
        <div className="outlaw-invite__summary">
          <p>{invite.rewardedInviteCount} OUTLAWS REWARDED</p>
          <p className="muted">
            The road remains open.
            <br />
            No more LEAF will be carried back.
          </p>
        </div>
      ) : (
        <div className="outlaw-invite__stats">
          <p>{invite.registeredInviteCount} ARRIVED</p>
          <p>{invite.inviteLeafGranted} LEAF CARRIED BACK</p>
          <p>{invite.rewardedInvitesRemaining} REWARDED INVITES REMAIN</p>
        </div>
      )}

      {invite.recentArrivals.length > 0 ? (
        <>
          <h3 className="outlaw-invite__recent-title">RECENT ARRIVALS</h3>
          <ul className="outlaw-invite__recent">
            {invite.recentArrivals.map((a) => (
              <li key={`${a.outlawLabel}-${a.arrivedAt}`}>
                {a.outlawLabel} ·{" "}
                {a.rewarded ? "ARRIVED · LEAF CARRIED BACK" : "ARRIVED"}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
