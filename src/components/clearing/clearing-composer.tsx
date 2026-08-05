"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { CLEARING_MESSAGE_MAX_CHARS } from "@/lib/clearing/config";
import type { SafeClearingMessage } from "@/lib/clearing/dto";
import { remainingLabel } from "@/lib/clearing/feed-client";
import {
  CLEARING_REGISTER_HREF,
  markClearingRegistrationOrigin,
} from "@/lib/clearing/origin";

export type ComposerIdentity =
  | { kind: "pending" }
  | { kind: "read_only" }
  | { kind: "claim_name" }
  /** Guest before first mint — may focus/type; Traveller created on intent. */
  | { kind: "guest" }
  | {
      kind: "traveller";
      displayName: string;
      messagesRemaining: number;
      speaking: "ok" | "muted" | "banned";
    }
  | {
      kind: "outlaw";
      alias: string;
      speaking: "ok" | "muted" | "banned";
    }
  | { kind: "registration_threshold" };

type Props = {
  identity: ComposerIdentity;
  slowModeUntil: number | null;
  minting: boolean;
  mintError: string | null;
  onEnsureTraveller: () => Promise<boolean>;
  onAccepted: (message: SafeClearingMessage, messagesRemaining?: number) => void;
  onSpeakBlocked: (code: string, message: string) => void;
  onSlowMode: (retryAfterMs: number) => void;
};

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Message composer — plain text only. Identity never chosen by the browser.
 */
export function ClearingComposer({
  identity,
  slowModeUntil,
  minting,
  mintError,
  onEnsureTraveller,
  onAccepted,
  onSpeakBlocked,
  onSlowMode,
}: Props) {
  const { getAuthHeaders, authenticated, registered } = useFennAuth();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusAnnounce, setStatusAnnounce] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sendingRef = useRef(false);
  const pendingRequestId = useRef<string | null>(null);
  const mintStartedFromFocus = useRef(false);

  useEffect(() => {
    if (!slowModeUntil) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [slowModeUntil]);

  const slowActive =
    typeof slowModeUntil === "number" && slowModeUntil > nowMs;
  const slowSecondsLeft = slowActive
    ? Math.max(1, Math.ceil((slowModeUntil - nowMs) / 1000))
    : 0;

  const canDraft =
    identity.kind === "guest" ||
    identity.kind === "traveller" ||
    identity.kind === "outlaw";

  const disabled =
    sending ||
    minting ||
    slowActive ||
    identity.kind === "pending" ||
    identity.kind === "read_only" ||
    identity.kind === "claim_name" ||
    identity.kind === "registration_threshold" ||
    (identity.kind === "traveller" && identity.speaking !== "ok") ||
    (identity.kind === "outlaw" && identity.speaking !== "ok") ||
    (identity.kind === "traveller" && identity.messagesRemaining <= 0);

  // Guests may type while mint is in flight after first focus.
  const inputDisabled =
    sending ||
    slowActive ||
    identity.kind === "pending" ||
    identity.kind === "read_only" ||
    identity.kind === "claim_name" ||
    identity.kind === "registration_threshold" ||
    (identity.kind === "traveller" && identity.speaking !== "ok") ||
    (identity.kind === "outlaw" && identity.speaking !== "ok") ||
    (identity.kind === "traveller" && identity.messagesRemaining <= 0);

  const showCharCount = draft.length >= Math.floor(CLEARING_MESSAGE_MAX_CHARS * 0.8);

  const onComposerFocus = useCallback(() => {
    if (identity.kind !== "guest") return;
    if (mintStartedFromFocus.current || minting) return;
    mintStartedFromFocus.current = true;
    void onEnsureTraveller().then((ok) => {
      if (!ok) mintStartedFromFocus.current = false;
    });
  }, [identity.kind, minting, onEnsureTraveller]);

  const submit = useCallback(async () => {
    if (sendingRef.current) return;
    if (identity.kind === "pending" || identity.kind === "read_only") return;
    if (identity.kind === "claim_name" || identity.kind === "registration_threshold")
      return;
    if (slowActive) return;

    const body = draft;
    if (!body.trim()) {
      setError("Say something, or wait.");
      return;
    }
    if (body.trim().length > CLEARING_MESSAGE_MAX_CHARS) {
      setError(`At most ${CLEARING_MESSAGE_MAX_CHARS} characters.`);
      return;
    }

    // Travellers (and guests before name arrives): mint/resume before post.
    if (identity.kind === "guest" || identity.kind === "traveller") {
      const ok = await onEnsureTraveller();
      if (!ok) return;
    }

    if (identity.kind === "traveller" && identity.messagesRemaining <= 0) {
      return;
    }
    if (
      (identity.kind === "traveller" || identity.kind === "outlaw") &&
      identity.speaking !== "ok"
    ) {
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);
    setStatusAnnounce("Your words are entering the wood.");

    const clientRequestId = pendingRequestId.current ?? newClientRequestId();
    pendingRequestId.current = clientRequestId;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authenticated && registered) {
        const auth = await getAuthHeaders();
        if (auth) Object.assign(headers, auth);
      }

      const res = await fetch("/api/clearing/messages", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          body,
          clientRequestId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: SafeClearingMessage;
        messagesRemaining?: number;
        reused?: boolean;
        error?: string;
        code?: string;
        registrationRequired?: boolean;
      };

      if (!res.ok || !data.ok || !data.message) {
        const code = data.code ?? "clearing_internal";
        const msg = data.error ?? "could not be heard.";
        setStatusAnnounce("");
        if (
          code === "clearing_muted" ||
          code === "clearing_banned" ||
          code === "clearing_read_only" ||
          code === "clearing_registration_required"
        ) {
          onSpeakBlocked(code, msg);
          if (code === "clearing_registration_required") {
            setStatusAnnounce(
              "Your travelling name has carried you this far.",
            );
          }
          setError(msg);
          if (code === "clearing_registration_required") {
            pendingRequestId.current = null;
          }
          return;
        }
        if (code === "clearing_slow_mode" || code === "clearing_rate_limited") {
          onSlowMode(Math.max(3, slowSecondsLeft || 5) * 1000);
          setError(msg);
          return;
        }
        setError(msg);
        return;
      }

      pendingRequestId.current = null;
      setDraft("");
      setStatusAnnounce("Your words reached the Clearing.");
      onAccepted(data.message, data.messagesRemaining);
      if (!slowActive) {
        onSlowMode(3_000);
      }
    } catch {
      setStatusAnnounce("");
      setError("the road did not answer. try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [
    authenticated,
    draft,
    getAuthHeaders,
    identity,
    onAccepted,
    onEnsureTraveller,
    onSlowMode,
    onSpeakBlocked,
    registered,
    slowActive,
    slowSecondsLeft,
  ]);

  function onForm(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  if (identity.kind === "pending") {
    return (
      <section className="clearing-composer clearing-composer--ready" aria-label="Speak">
        <p className="muted clearing-composer__pending" aria-live="polite">
          The path is still opening…
        </p>
      </section>
    );
  }

  if (identity.kind === "read_only") {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">THE CLEARING IS LISTENING.</p>
        <p className="muted">
          No new voices are being admitted just now.
        </p>
      </section>
    );
  }

  if (identity.kind === "claim_name") {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">YOUR WALLET IS KNOWN.</p>
        <p className="clearing-composer__law">YOUR NAME IS NOT YET WRITTEN.</p>
        <p className="clearing-composer__actions">
          <Link
            href={CLEARING_REGISTER_HREF}
            className="btn-text"
            onClick={() => markClearingRegistrationOrigin()}
          >
            [ CLAIM A NAME ]
          </Link>
        </p>
      </section>
    );
  }

  if (identity.kind === "registration_threshold") {
    return (
      <section
        className="clearing-composer"
        aria-label="Speak"
        aria-live="polite"
      >
        <p className="clearing-composer__law">
          YOUR TRAVELLING NAME HAS CARRIED YOU THIS FAR.
        </p>
        <p className="muted">
          Choose the name the Register will remember.
        </p>
        <p className="clearing-composer__actions">
          <Link
            href={CLEARING_REGISTER_HREF}
            className="btn-text"
            onClick={() => markClearingRegistrationOrigin()}
          >
            [ BECOME AN OUTLAW ]
          </Link>
        </p>
      </section>
    );
  }

  if (
    (identity.kind === "traveller" || identity.kind === "outlaw") &&
    identity.speaking === "muted"
  ) {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">
          THE CLEARING DOES NOT HEAR YOU JUST NOW.
        </p>
      </section>
    );
  }

  if (
    (identity.kind === "traveller" || identity.kind === "outlaw") &&
    identity.speaking === "banned"
  ) {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">
          THIS ROAD IS CLOSED TO YOUR VOICE.
        </p>
      </section>
    );
  }

  if (identity.kind === "traveller" && identity.messagesRemaining <= 0) {
    return (
      <section className="clearing-composer" aria-label="Speak" aria-live="polite">
        <p className="clearing-composer__law">
          YOUR TRAVELLING NAME HAS CARRIED YOU THIS FAR.
        </p>
        <p className="clearing-composer__actions">
          <Link
            href={CLEARING_REGISTER_HREF}
            className="btn-text"
            onClick={() => markClearingRegistrationOrigin()}
          >
            [ BECOME AN OUTLAW ]
          </Link>
        </p>
      </section>
    );
  }

  if (!canDraft) {
    return null;
  }

  const identityLine =
    identity.kind === "traveller"
      ? `YOU ARE ${identity.displayName.toUpperCase()}`
      : identity.kind === "outlaw"
        ? `SPEAK AS ${identity.alias}`
        : "SPEAK AS A TRAVELLER";

  const allowance =
    identity.kind === "traveller"
      ? remainingLabel(identity.messagesRemaining)
      : identity.kind === "guest"
        ? "Three times from a travelling name."
        : null;

  const sendDisabled =
    disabled ||
    !draft.trim() ||
    (identity.kind === "guest" && minting);

  return (
    <section className="clearing-composer" aria-label="Speak">
      <div className="clearing-composer__identity">
        <p className="clearing-composer__who">{identityLine}</p>
        {allowance ? (
          <p className="muted clearing-composer__remain">{allowance}</p>
        ) : null}
        {identity.kind === "guest" && minting ? (
          <p className="muted clearing-composer__minting" aria-live="polite">
            Taking a temporary name…
          </p>
        ) : null}
      </div>

      {slowActive ? (
        <p className="muted clearing-composer__slow" aria-live="polite">
          THE ROAD ASKS FOR PATIENCE.
          <span className="clearing-composer__slow-detail">
            {" "}
            You may speak again shortly
            {slowSecondsLeft > 0 ? ` (${slowSecondsLeft}s)` : ""}.
          </span>
        </p>
      ) : null}

      {sending ? (
        <p
          className="clearing-composer__writing"
          aria-live="assertive"
          role="status"
        >
          YOUR WORDS ARE ENTERING THE WOOD…
        </p>
      ) : null}

      <form className="clearing-composer__form" onSubmit={onForm}>
        <label className="clearing-composer__label" htmlFor="clearing-draft">
          Your words
        </label>
        <textarea
          id="clearing-draft"
          className="clearing-composer__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onComposerFocus}
          rows={3}
          maxLength={CLEARING_MESSAGE_MAX_CHARS}
          disabled={inputDisabled}
          placeholder="Speak into the Clearing…"
          autoComplete="off"
        />
        <div className="clearing-composer__bar">
          {showCharCount ? (
            <span className="muted clearing-composer__count">
              {draft.length}/{CLEARING_MESSAGE_MAX_CHARS}
            </span>
          ) : (
            <span className="clearing-composer__count" aria-hidden />
          )}
          <button
            type="submit"
            className="btn-text clearing-composer__send"
            disabled={sendDisabled}
          >
            {sending ? "[ WRITING… ]" : "[ SPEAK ]"}
          </button>
        </div>
      </form>

      {mintError ? (
        <p className="clearing-composer__error muted" role="status">
          {mintError}
        </p>
      ) : null}
      {error ? (
        <p className="clearing-composer__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {statusAnnounce}
      </p>
    </section>
  );
}
