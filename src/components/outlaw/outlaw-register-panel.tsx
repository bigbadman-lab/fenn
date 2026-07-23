"use client";

import Link from "next/link";
import { FormEvent, useState, type ReactNode } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  CONTRIBUTION_TYPES,
  GREENWOOD_TERMS_VERSION,
} from "@/lib/profiles/constants";
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

type OutlawRegisterPanelProps = {
  /** When true, omit the outer article chrome (homepage section provides it). */
  embedded?: boolean;
};

export function OutlawRegisterPanel({
  embedded = false,
}: OutlawRegisterPanelProps) {
  const {
    privyReady,
    loading,
    authenticated,
    registered,
    profile,
    wallets,
    walletResolving,
    error,
    login,
    getAuthHeaders,
    refreshMe,
  } = useFennAuth();

  const [chosenName, setChosenName] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [whyStatement, setWhyStatement] = useState("");
  const [contributionType, setContributionType] =
    useState<(typeof CONTRIBUTION_TYPES)[number]>("finding things");
  const [vowAccepted, setVowAccepted] = useState(false);
  const [manualWallet, setManualWallet] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successNumber, setSuccessNumber] = useState<number | null>(null);

  const selectedWallet =
    wallets.length === 1
      ? (wallets[0] ?? "")
      : wallets.length > 1 &&
          manualWallet &&
          wallets.includes(manualWallet)
        ? manualWallet
        : "";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!vowAccepted) {
      setFormError("the vow must be accepted.");
      return;
    }

    if (!selectedWallet) {
      setFormError("choose a wallet.");
      return;
    }

    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setFormError("missing auth tokens. reconnect.");
        return;
      }

      const response = await fetch("/api/outlaw/register", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chosenName,
          xHandle: xHandle || null,
          whyStatement,
          contributionType,
          vowAccepted: true,
          termsVersion: GREENWOOD_TERMS_VERSION,
          walletAddress: selectedWallet,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        profile?: { outlawNumber: number };
      };

      if (!response.ok) {
        setFormError(data.error ?? "registration failed.");
        return;
      }

      setSuccessNumber(data.profile?.outlawNumber ?? null);
      await refreshMe();
    } catch {
      setFormError("registration failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function wrap(body: ReactNode, title = true) {
    if (embedded) {
      return <div className="place__body">{body}</div>;
    }
    return (
      <article className="place">
        {title ? (
          <AsciiPageTitle
            title="THE OUTLAW REGISTER"
            mark="REGISTER"
            accent="outlaw"
          />
        ) : null}
        <div className="place__body">{body}</div>
      </article>
    );
  }

  if (!privyReady || loading) {
    return wrap(
      <p className="muted">
        {authenticated
          ? "the wood is checking its books."
          : "the wood is listening..."}
      </p>,
    );
  }

  if (!authenticated) {
    return wrap(
      <>
        <p>the path asks for a wallet before a name.</p>
        <p>
          <button type="button" className="btn-text" onClick={() => login()}>
            [ enter ]
          </button>
        </p>
      </>,
    );
  }

  if (walletResolving) {
    return wrap(
      <p className="muted">the wood is preparing a place for you.</p>,
    );
  }

  if (error && !registered) {
    return wrap(
      <>
        <p className="muted">the wood could not verify this session.</p>
        <p className="muted">{error}</p>
      </>,
    );
  }

  if (registered && profile) {
    return wrap(
      <div className="profile-block">
        <p>the wood remembers you.</p>
        <p>
          OUTLAW {formatOutlawNumber(profile.outlawNumber)}
        </p>
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
          leaf:
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
        <p>
          <Link href="/outlaw">[ the outlaw ]</Link>
        </p>
      </div>,
    );
  }

  if (successNumber !== null) {
    return wrap(
      <>
        <p>accepted.</p>
        <p>outlaw {formatOutlawNumber(successNumber)}</p>
        <p>
          <Link href="/outlaw">[ continue ]</Link>
        </p>
      </>,
    );
  }

  if (wallets.length === 0) {
    return wrap(
      <p className="muted">no verified evm wallet is ready yet.</p>,
    );
  }

  return wrap(
    <>
      <p>the wood needs a name.</p>
      <p className="muted">
        the wallet you choose here becomes your permanent mark.
      </p>

      <form className="fenn-form" onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="chosenName">known as</label>
        <input
          id="chosenName"
          name="chosenName"
          value={chosenName}
          onChange={(event) => setChosenName(event.target.value)}
          required
          maxLength={48}
          autoComplete="off"
        />

        <label htmlFor="xHandle">x handle (optional)</label>
        <input
          id="xHandle"
          name="xHandle"
          value={xHandle}
          onChange={(event) => setXHandle(event.target.value)}
          maxLength={32}
          autoComplete="off"
          placeholder="@..."
        />

        <label htmlFor="whyStatement">
          why should the wood let you through?
        </label>
        <textarea
          id="whyStatement"
          name="whyStatement"
          value={whyStatement}
          onChange={(event) => setWhyStatement(event.target.value)}
          required
          maxLength={2000}
          rows={5}
        />

        <label htmlFor="contributionType">preferred contribution</label>
        <select
          id="contributionType"
          name="contributionType"
          value={contributionType}
          onChange={(event) =>
            setContributionType(
              event.target.value as (typeof CONTRIBUTION_TYPES)[number],
            )
          }
        >
          {CONTRIBUTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {wallets.length === 1 ? (
          <p>
            wallet:
            <br />
            {abbreviateEvmAddress(selectedWallet)}
          </p>
        ) : (
          <>
            <label htmlFor="walletAddress">wallet anchor</label>
            <select
              id="walletAddress"
              name="walletAddress"
              value={selectedWallet}
              onChange={(event) => setManualWallet(event.target.value)}
              required
            >
              <option value="">choose a verified wallet</option>
              {wallets.map((wallet) => (
                <option key={wallet} value={wallet}>
                  {abbreviateEvmAddress(wallet)}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="fenn-form__check" htmlFor="vowAccepted">
          <input
            id="vowAccepted"
            name="vowAccepted"
            type="checkbox"
            checked={vowAccepted}
            onChange={(event) => setVowAccepted(event.target.checked)}
          />
          <span>i will not hoard what ought to circulate.</span>
        </label>

        <p className="muted">terms: {GREENWOOD_TERMS_VERSION}</p>

        {formError ? <p className="form-error">{formError}</p> : null}

        <button
          type="submit"
          className="btn-text"
          disabled={submitting || !selectedWallet}
        >
          {submitting ? "[ waiting ]" : "[ enter ]"}
        </button>
      </form>
    </>,
  );
}
