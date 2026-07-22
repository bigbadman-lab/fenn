"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import {
  CONTRIBUTION_TYPES,
  GREENWOOD_TERMS_VERSION,
} from "@/lib/profiles/constants";
import { formatOutlawNumber } from "@/lib/profiles/types";
import { abbreviateEvmAddress } from "@/lib/wallet/evm";

export default function OutlawRegisterPage() {
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

  if (!privyReady || loading) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <p className="muted">
          {authenticated
            ? "the wood is checking its books."
            : "the wood is listening..."}
        </p>
      </article>
    );
  }

  if (!authenticated) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <div className="place__body">
          <p>the path asks for a wallet before a name.</p>
          <p>
            <button type="button" className="btn-text" onClick={() => login()}>
              [ connect ]
            </button>
          </p>
        </div>
      </article>
    );
  }

  if (walletResolving) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <p className="muted">the wood is preparing a place for you.</p>
      </article>
    );
  }

  if (error && !registered) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <div className="place__body">
          <p className="muted">the wood could not verify this session.</p>
          <p className="muted">{error}</p>
        </div>
      </article>
    );
  }

  if (registered && profile) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <div className="place__body">
          <p>the wood already knows you.</p>
          <p>outlaw {formatOutlawNumber(profile.outlawNumber)}</p>
          <p>
            <Link href="/outlaw">[ the outlaw ]</Link>
          </p>
        </div>
      </article>
    );
  }

  if (successNumber !== null) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <div className="place__body">
          <p>accepted.</p>
          <p>outlaw {formatOutlawNumber(successNumber)}</p>
          <p>
            <Link href="/outlaw">[ continue ]</Link>
          </p>
        </div>
      </article>
    );
  }

  if (wallets.length === 0) {
    return (
      <article className="place">
        <h1 className="place__title">THE OUTLAW REGISTER</h1>
        <div className="place__body">
          <p className="muted">no verified evm wallet is ready yet.</p>
        </div>
      </article>
    );
  }

  return (
    <article className="place">
      <h1 className="place__title">THE OUTLAW REGISTER</h1>
      <div className="place__body">
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
      </div>
    </article>
  );
}
