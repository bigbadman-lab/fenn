"use client";

import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";

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

  if (!privyReady || loading || walletResolving) {
    return (
      <article className="place">
        <h1 className="place__title">OUTLAW</h1>
        <p className="muted">
          {walletResolving
            ? "the wood is preparing a place for you."
            : authenticated
              ? "the wood is checking its books."
              : "looking..."}
        </p>
      </article>
    );
  }

  if (!authenticated) {
    return (
      <article className="place">
        <h1 className="place__title">OUTLAW</h1>
        <div className="place__body">
          <p>the wood does not know you yet.</p>
          <p>
            <button type="button" className="btn-text" onClick={() => login()}>
              [ connect ]
            </button>
          </p>
        </div>
      </article>
    );
  }

  if (error && !registered) {
    return (
      <article className="place">
        <h1 className="place__title">OUTLAW</h1>
        <div className="place__body">
          <p className="muted">the wood could not verify this session.</p>
          <p className="muted">{error}</p>
        </div>
      </article>
    );
  }

  if (!registered || !profile) {
    return (
      <article className="place">
        <h1 className="place__title">OUTLAW</h1>
        <div className="place__body">
          <p>the wood does not know your name yet.</p>
          <p>
            <Link href="/outlaw/register">[ register ]</Link>
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="place">
      <h1 className="place__title">
        OUTLAW {formatOutlawNumber(profile.outlawNumber)}
      </h1>
      <div className="place__body profile-block">
        <p>
          known as:
          <br />
          {profile.alias ?? "—"}
        </p>
        <p>
          wallet:
          <br />
          {abbreviateEvmAddress(profile.walletAddress)}
        </p>
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
          entered means joining FENN, not Greenwood admission.
        </p>
      </div>
    </article>
  );
}
