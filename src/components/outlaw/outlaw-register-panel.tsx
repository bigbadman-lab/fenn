"use client";

import Link from "next/link";
import { FormEvent, useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { AsciiPageTitle } from "@/components/ui/ascii-page-title";
import {
  CONTRIBUTION_TYPES,
  GREENWOOD_TERMS_VERSION,
} from "@/lib/profiles/constants";
import {
  OUTLAW_REGISTRATION_ARRIVAL_PATH,
  REGISTRATION_WRITE_OPEN_FAILED_COPY,
  REGISTRATION_WRITING_COPY,
  type OutlawRegisterPhase,
} from "@/lib/profiles/registration-arrival";
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

function InviteLedNotice() {
  const searchParams = useSearchParams();
  const led = searchParams.get("led") === "1";
  if (!led) return null;

  const from = searchParams.get("from")?.trim() ?? "";
  const safeFrom =
    from.length > 0 && /^OUTLAW\s+\d{1,8}$/i.test(from) ? from.toUpperCase() : null;

  return (
    <div className="invite-landing" aria-label="Invite arrival">
      <p className="invite-landing__kicker">
        {safeFrom ? `${safeFrom} LED YOU TO THE ROAD` : "AN OUTLAW LED YOU HERE"}
      </p>
      <p>The road is still yours to walk.</p>
      <p className="muted">
        Complete the Register and your arrival will be remembered.
      </p>
    </div>
  );
}

type OutlawRegisterPanelProps = {
  /** When true, omit the outer article chrome (homepage section provides it). */
  embedded?: boolean;
};

export function OutlawRegisterPanel({
  embedded = false,
}: OutlawRegisterPanelProps) {
  const router = useRouter();
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
  const [phase, setPhase] = useState<OutlawRegisterPhase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  /** One authoritative navigation path after a successful write. */
  const navigatedRef = useRef(false);

  const selectedWallet =
    wallets.length === 1
      ? (wallets[0] ?? "")
      : wallets.length > 1 &&
          manualWallet &&
          wallets.includes(manualWallet)
        ? manualWallet
        : "";

  const formLocked = phase !== "idle";

  /**
   * Profile exists; refresh bootstrap then replace to /outlaw.
   * Does not re-call registration if refresh fails.
   */
  const openRoadAfterWrite = useCallback(async () => {
    if (navigatedRef.current) return;
    setPhase("writing");
    try {
      const refreshed = await refreshMe();
      if (!refreshed) {
        setPhase("write_open_failed");
        return;
      }
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      router.replace(OUTLAW_REGISTRATION_ARRIVAL_PATH);
    } catch {
      setPhase("write_open_failed");
    }
  }, [refreshMe, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (phase !== "idle") {
      return;
    }

    if (!vowAccepted) {
      setFormError("the vow must be accepted.");
      return;
    }

    if (!selectedWallet) {
      setFormError("choose a wallet.");
      return;
    }

    setPhase("submitting");
    let profileWritten = false;
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setFormError("missing auth tokens. reconnect.");
        setPhase("idle");
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
        setPhase("idle");
        return;
      }

      // Created (201) or idempotent re-register (200): profile exists.
      // Invite side effects complete server-side before this response.
      profileWritten = true;
      await openRoadAfterWrite();
    } catch {
      if (profileWritten) {
        setPhase("write_open_failed");
      } else {
        setFormError("registration failed.");
        setPhase("idle");
      }
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

  if (phase === "writing") {
    return wrap(
      <div
        className="outlaw-register-holding"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p>{REGISTRATION_WRITING_COPY.title}</p>
        <p>{REGISTRATION_WRITING_COPY.body}</p>
        <p className="muted">{REGISTRATION_WRITING_COPY.status}</p>
      </div>,
    );
  }

  if (phase === "write_open_failed") {
    return wrap(
      <div
        className="outlaw-register-holding"
        role="status"
        aria-live="polite"
      >
        <p>{REGISTRATION_WRITE_OPEN_FAILED_COPY.title}</p>
        <p>{REGISTRATION_WRITE_OPEN_FAILED_COPY.body}</p>
        <p>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              void openRoadAfterWrite();
            }}
          >
            {REGISTRATION_WRITE_OPEN_FAILED_COPY.action}
          </button>
        </p>
      </div>,
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
        <InviteLedNotice />
        <p>the path asks for a wallet before a name.</p>
        <p>
          <button
            type="button"
            className={
              embedded
                ? "btn-text home-register__begin"
                : "btn-text"
            }
            onClick={() => login()}
          >
            [ begin ]
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

  if (wallets.length === 0) {
    return wrap(
      <p className="muted">no verified evm wallet is ready yet.</p>,
    );
  }

  return wrap(
    <>
      <InviteLedNotice />
      <p>the wood needs a name.</p>
      <p className="muted">
        the wallet you choose here becomes your permanent mark.
      </p>

      <form
        className="fenn-form"
        onSubmit={(event) => void onSubmit(event)}
        aria-busy={phase === "submitting" || undefined}
      >
        <label htmlFor="chosenName">known as</label>
        <input
          id="chosenName"
          name="chosenName"
          value={chosenName}
          onChange={(event) => setChosenName(event.target.value)}
          required
          maxLength={48}
          autoComplete="off"
          disabled={formLocked}
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
          disabled={formLocked}
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
          disabled={formLocked}
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
          disabled={formLocked}
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
              disabled={formLocked}
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
            disabled={formLocked}
          />
          <span>i will not hoard what ought to circulate.</span>
        </label>

        <p className="muted">terms: {GREENWOOD_TERMS_VERSION}</p>

        {formError ? <p className="form-error">{formError}</p> : null}

        <button
          type="submit"
          className="btn-text"
          disabled={formLocked || !selectedWallet}
        >
          {phase === "submitting" ? "[ waiting ]" : "[ claim the name ]"}
        </button>
      </form>
    </>,
  );
}
