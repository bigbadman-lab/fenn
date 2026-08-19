"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { OutlawFirstThirty } from "@/components/outlaw/outlaw-first-thirty";
import { OutlawInvite } from "@/components/outlaw/outlaw-invite";
import { OutlawWallet } from "@/components/outlaw/outlaw-wallet";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  CLEARING_PATH,
  peekClearingRegistrationOrigin,
} from "@/lib/clearing/origin";
import { CLEARING_PUBLIC_SURFACE_ENABLED } from "@/lib/clearing/visibility";
import {
  CANOPY_DISPLAY,
  formatNamedLabel,
  REGISTER_ANCHOR_HREF,
  NAMED_DISPLAY,
} from "@/lib/site/world-vocabulary";

function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

function NamedTitle({ subtitle }: { subtitle?: ReactNode }) {
  return (
    <AsciiPageTitle
      title={NAMED_DISPLAY.pageTitle}
      mark={NAMED_DISPLAY.pageTitle}
      accent="outlaw"
      subtitle={subtitle}
    />
  );
}

export default function OutlawPage() {
  const {
    privyReady,
    loading,
    authenticated,
    registered,
    profile,
    walletResolving,
    error,
    login,
  } = useFennAuth();

  const [fromClearing, setFromClearing] = useState(false);
  useEffect(() => {
    setFromClearing(peekClearingRegistrationOrigin());
  }, []);

  // Single intentional full-content gate while bootstrap resolves.
  // No fake Outlaw number / LEAF zeros.
  if (!privyReady || loading || walletResolving) {
    return (
      <article className="place outlaw-page outlaw-page--resolving">
        <NamedTitle
          subtitle={
            <p className="muted" aria-live="polite">
              {walletResolving
                ? "the wood is preparing a place for you."
                : authenticated
                  ? "the road is being read..."
                  : "looking..."}
            </p>
          }
        />
        {authenticated && !walletResolving ? (
          <div className="outlaw-page__resolve-frame" aria-hidden>
            <div className="outlaw-ft-region outlaw-ft-region--placeholder" />
            <div className="outlaw-invite outlaw-invite--stable outlaw-invite--placeholder" />
          </div>
        ) : null}
      </article>
    );
  }

  if (!authenticated) {
    return (
      <article className="place">
        <NamedTitle
          subtitle={
            <>
              <p>the wood does not know you yet.</p>
              <p>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => login()}
                >
                  [ enter ]
                </button>
              </p>
            </>
          }
        />
      </article>
    );
  }

  if (error && !registered) {
    return (
      <article className="place">
        <NamedTitle
          subtitle={
            <>
              <p className="muted">the wood could not verify this session.</p>
              <p className="muted">{error}</p>
            </>
          }
        />
      </article>
    );
  }

  if (!registered || !profile) {
    return (
      <article className="place">
        <NamedTitle
          subtitle={
            <>
              <p>the wood does not know your name yet.</p>
              <p>
                <Link href={REGISTER_ANCHOR_HREF}>[ register ]</Link>
              </p>
            </>
          }
        />
      </article>
    );
  }

  // Identity, journey, invite, and account from one bootstrap snapshot.
  return (
    <article className="place outlaw-page">
      <NamedTitle
        subtitle={
          <p className="ascii-page-title__outlaw-no">
            {formatNamedLabel(profile.outlawNumber)}
          </p>
        }
      />

      {CLEARING_PUBLIC_SURFACE_ENABLED ? (
        <div className="place__body outlaw-page__clearing-return">
          {fromClearing ? <p>YOUR NAME IS WRITTEN.</p> : null}
          <p>
            <Link href={CLEARING_PATH} className="btn-text">
              {fromClearing
                ? "[ RETURN TO THE CLEARING ]"
                : "[ THE CLEARING ]"}
            </Link>
          </p>
        </div>
      ) : null}

      <div className="place__body profile-block outlaw-page__identity">
        <p>
          known as:
          <br />
          {profile.alias ?? "—"}
        </p>
      </div>

      <OutlawFirstThirty />

      <OutlawInvite />

      <OutlawWallet />

      <div className="place__body profile-block outlaw-page__account">
        <p>
          current leaf:
          <br />
          {profile.leafBalance}
        </p>
        <p>
          lifetime leaf:
          <br />
          {profile.leafLifetimeEarned}
        </p>
        <p>
          deeds:
          <br />
          {profile.deedsCompletedCount}
        </p>
        <p>
          entered:
          <br />
          {formatJoinedDate(profile.joinedAt)}
        </p>
        <p className="muted">
          entered means joining VELL, not {CANOPY_DISPLAY.short} admission.
        </p>
      </div>
    </article>
  );
}
