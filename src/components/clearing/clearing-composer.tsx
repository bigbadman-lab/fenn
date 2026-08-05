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
import {
  CLEARING_REGISTER_HREF,
  markClearingRegistrationOrigin,
} from "@/lib/clearing/origin";

export type ComposerIdentity =
  | { kind: "pending" }
  | { kind: "read_only" }
  | { kind: "claim_name" }
  /** Unauthenticated — may listen; speaking is for Outlaws only. */
  | { kind: "outlaw_required" }
  | {
      kind: "outlaw";
      alias: string;
      speaking: "ok" | "muted" | "banned";
    };

type Props = {
  identity: ComposerIdentity;
  slowModeUntil: number | null;
  onAccepted: (message: SafeClearingMessage) => void;
  onSpeakBlocked: (code: string, message: string) => void;
  onSlowMode: (retryAfterMs: number) => void;
};

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = (c === "x" ? r : (r & 0x3) | 0x8);
    return v.toString(16);
  });
}

/**
 * Message composer — plain text only. Outlaws may speak; others may listen.
 */
export function ClearingComposer({
  identity,
  slowModeUntil,
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

  const canDraft = identity.kind === "outlaw";

  const disabled =
    sending ||
    slowActive ||
    identity.kind === "pending" ||
    identity.kind === "read_only" ||
    identity.kind === "claim_name" ||
    identity.kind === "outlaw_required" ||
    (identity.kind === "outlaw" && identity.speaking !== "ok");

  const inputDisabled = disabled;

  const showCharCount = draft.length > CLEARING_MESSAGE_MAX_CHARS * 0.75;

  const submit = useCallback(async () => {
    if (sendingRef.current) return;
    if (identity.kind !== "outlaw" || identity.speaking !== "ok") return;
    if (slowActive) return;

    const text = draft.trim();
    if (!text) return;

    if (!(authenticated && registered)) {
      onSpeakBlocked(
        "clearing_registration_required",
        "Only Outlaws may speak in the Clearing.",
      );
      return;
    }

    sendingRef.current = true;
    setSending(true);
    setError(null);
    setStatusAnnounce("YOUR WORDS ARE ENTERING THE WOOD…");

    const clientRequestId =
      pendingRequestId.current ?? newClientRequestId();
    pendingRequestId.current = clientRequestId;

    try {
      const authHeaders = (await getAuthHeaders()) ?? {};
      const res = await fetch("/api/clearing/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ body: text, clientRequestId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: SafeClearingMessage;
        error?: string;
        code?: string;
        retryAfterMs?: number;
      };

      if (!res.ok || !data.ok || !data.message) {
        setStatusAnnounce("");
        const code = data.code ?? "clearing_internal";
        const msg =
          data.error ?? "the road did not take those words. try again.";
        if (
          code === "clearing_muted" ||
          code === "clearing_banned" ||
          code === "clearing_read_only" ||
          code === "clearing_registration_required"
        ) {
          onSpeakBlocked(code, msg);
          setError(msg);
          return;
        }
        if (code === "clearing_rate_limited" || code === "clearing_slow_mode") {
          const retry =
            typeof data.retryAfterMs === "number"
              ? data.retryAfterMs
              : Math.max(3, slowSecondsLeft || 5) * 1000;
          onSlowMode(retry);
          setError(msg);
          return;
        }
        setError(msg);
        return;
      }

      pendingRequestId.current = null;
      setDraft("");
      setStatusAnnounce("Your words reached the Clearing.");
      onAccepted(data.message);
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

  if (identity.kind === "outlaw_required") {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">ONLY OUTLAWS MAY SPEAK HERE.</p>
        <p className="muted">
          Anyone may listen. Take a permanent name if you would join the circle.
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

  if (identity.kind === "outlaw" && identity.speaking === "muted") {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">
          THE CLEARING DOES NOT HEAR YOU JUST NOW.
        </p>
      </section>
    );
  }

  if (identity.kind === "outlaw" && identity.speaking === "banned") {
    return (
      <section className="clearing-composer" aria-label="Speak">
        <p className="clearing-composer__law">
          THIS ROAD IS CLOSED TO YOUR VOICE.
        </p>
      </section>
    );
  }

  if (!canDraft) {
    return null;
  }

  const sendDisabled = disabled || !draft.trim();

  return (
    <section className="clearing-composer" aria-label="Speak">
      <div className="clearing-composer__identity">
        <p className="clearing-composer__who">{`SPEAK AS ${identity.alias}`}</p>
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
