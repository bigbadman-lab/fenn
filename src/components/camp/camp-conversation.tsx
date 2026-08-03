"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { CampCharacterId } from "@/components/camp/camp-characters";
import { FirstThirtyAcknowledge } from "@/components/first-thirty/first-thirty-acknowledge";
import { FirstThirtyProgressPanel } from "@/components/first-thirty/first-thirty-progress";
import { useFirstThirtyProgress } from "@/hooks/use-first-thirty";
import {
  CAMP_EMPTY_CONVERSATION_PROMPTS,
  CAMP_USER_MESSAGE_MAX_CHARS,
} from "@/lib/camp/config";
import { campErrorCopy } from "@/lib/camp/errors";
import type { SafeCampMessage } from "@/lib/camp/dto";
import {
  FIRST_THIRTY_FAILURE_COPY,
  FIRST_THIRTY_INELIGIBLE_COPY,
  formatEligibleExchangeQuiet,
  firstThirtyEventSessionKey,
  shouldAnnounceFirstThirtyEvent,
  shouldShowActiveFirstThirty,
  shouldShowGreenwoodOpenAction,
} from "@/lib/first-thirty/presentation";
import type {
  FirstThirtyMilestoneEvent,
  SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";
import { formatOutlawNumber } from "@/lib/profiles/types";

type CampConversationProps = {
  characterId: CampCharacterId;
  characterName: string;
};

type ConversationResponse = {
  ok?: boolean;
  conversation?: {
    messages: SafeCampMessage[];
    hasOlderMessages?: boolean;
  };
  code?: string;
  error?: string;
};

type SendResponse = {
  ok?: boolean;
  userMessage?: SafeCampMessage;
  assistantMessage?: SafeCampMessage;
  reward?: { granted?: number };
  rewardUnavailable?: boolean;
  firstThirtyUnavailable?: boolean;
  firstThirty?: SafeFirstThirtyProgress;
  code?: string;
  error?: string;
};

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function CampConversation({
  characterId,
  characterName,
}: CampConversationProps) {
  const {
    privyReady,
    loading,
    authenticated,
    registered,
    profile,
    profileLoading,
    profileResolved,
    login,
    getAuthHeaders,
    refreshMe,
  } = useFennAuth();

  const { progress: fetchedProgress } = useFirstThirtyProgress(
    Boolean(authenticated && registered),
  );

  const [messages, setMessages] = useState<SafeCampMessage[] | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingClientMessageId, setPendingClientMessageId] = useState<
    string | null
  >(null);
  const [activeCharacterId, setActiveCharacterId] = useState(characterId);
  const [turnProgress, setTurnProgress] =
    useState<SafeFirstThirtyProgress | null>(null);
  const [reveal, setReveal] = useState<{
    event: FirstThirtyMilestoneEvent;
    progress: SafeFirstThirtyProgress;
    eventKey: string;
    afterMessageId: string;
  } | null>(null);
  const [quietNote, setQuietNote] = useState<string | null>(null);
  const [ineligibleHint, setIneligibleHint] = useState(false);
  const [countFailure, setCountFailure] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const lastIneligibleShownRef = useRef(false);

  // Reset local transcript state when the selected character changes (render-time).
  if (characterId !== activeCharacterId) {
    setActiveCharacterId(characterId);
    setMessages(null);
    setHasOlderMessages(false);
    setDraft("");
    setError(null);
    setPendingClientMessageId(null);
    setSending(false);
    setReveal(null);
    setQuietNote(null);
    setIneligibleHint(false);
    setCountFailure(false);
    setTurnProgress(null);
  }

  const progress = turnProgress ?? fetchedProgress;

  const outlawLabel = profile
    ? `OUTLAW ${formatOutlawNumber(profile.outlawNumber)}`
    : "YOU";

  const emptyPrompt = CAMP_EMPTY_CONVERSATION_PROMPTS[characterId];

  const loadConversation = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }
    const response = await fetch(`/api/camp/${characterId}/messages`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as ConversationResponse;
    if (!response.ok) {
      setMessages([]);
      setHasOlderMessages(false);
      setError(campErrorCopy(data.code ?? "internal_error"));
      return;
    }
    setMessages(data.conversation?.messages ?? []);
    setHasOlderMessages(Boolean(data.conversation?.hasOlderMessages));
  }, [characterId, getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !authenticated || !registered) return;
    if (profileLoading || !profileResolved) return;
    const timer = window.setTimeout(() => {
      void loadConversation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    privyReady,
    loading,
    authenticated,
    registered,
    profileLoading,
    profileResolved,
    loadConversation,
  ]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, reveal, quietNote]);

  function applyFirstThirtyTurn(
    data: SendResponse,
    assistantId: string,
  ): void {
    if (data.firstThirtyUnavailable) {
      setCountFailure(true);
      setQuietNote(null);
      setIneligibleHint(false);
      // Do not advance trusted progress from a failed count.
      return;
    }
    setCountFailure(false);

    const ft = data.firstThirty;
    if (!ft) {
      // Progress fetch can still recover on next load.
      return;
    }

    setTurnProgress(ft);

    const event = ft.lastEvent?.newlySatisfied ? ft.lastEvent : null;
    if (event) {
      const eventKey = firstThirtyEventSessionKey({
        messageId: assistantId,
        event,
        lifetimeLeaf: ft.lifetimeLeaf,
      });
      if (
        shouldAnnounceFirstThirtyEvent({
          event,
          eventKey,
          seenKeys: seenEventsRef.current,
        })
      ) {
        seenEventsRef.current.add(eventKey);
        setReveal({
          event,
          progress: ft,
          eventKey,
          afterMessageId: assistantId,
        });
        setQuietNote(null);
        setIneligibleHint(false);
        lastIneligibleShownRef.current = false;
        if (event.actualGrant > 0 || event.greenwoodOpen) {
          void refreshMe({ quiet: true });
        }
        return;
      }
      // Already announced (idempotent replay) — keep steady progress only.
      setReveal(null);
      setQuietNote(null);
      return;
    }

    setReveal(null);

    const quiet = formatEligibleExchangeQuiet(ft);
    if (quiet) {
      setQuietNote(quiet);
      setIneligibleHint(false);
      lastIneligibleShownRef.current = false;
      return;
    }

    // Valid reply, active path, but exchange not counted — restrained once.
    if (
      shouldShowActiveFirstThirty(ft) &&
      ft.exchangeCounted === false
    ) {
      if (!lastIneligibleShownRef.current) {
        setIneligibleHint(true);
        lastIneligibleShownRef.current = true;
      } else {
        setIneligibleHint(false);
      }
      setQuietNote(null);
      return;
    }

    setQuietNote(null);
    setIneligibleHint(false);
  }

  async function submitTurn(clientMessageId: string, text: string) {
    setSending(true);
    setError(null);
    setPendingClientMessageId(clientMessageId);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError(campErrorCopy("camp_not_authenticated"));
        return;
      }
      const response = await fetch(`/api/camp/${characterId}/messages`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          clientMessageId,
        }),
      });
      const data = (await response.json()) as SendResponse;
      if (!response.ok || !data.userMessage || !data.assistantMessage) {
        setError(campErrorCopy(data.code ?? "camp_ai_invalid_response"));
        return;
      }

      const granted = Math.max(
        0,
        Number(
          data.assistantMessage.rewardGranted ?? data.reward?.granted ?? 0,
        ),
      );
      const assistantWithReward: SafeCampMessage = {
        ...data.assistantMessage,
        ...(granted > 0 ? { rewardGranted: granted } : {}),
      };

      setMessages((prev) => {
        const next = prev ? [...prev] : [];
        const withoutDupes = next.filter(
          (m) =>
            m.id !== data.userMessage!.id &&
            m.id !== data.assistantMessage!.id,
        );
        return [...withoutDupes, data.userMessage!, assistantWithReward];
      });
      setDraft("");
      setPendingClientMessageId(null);

      applyFirstThirtyTurn(data, data.assistantMessage.id);

      if (granted > 0) {
        void refreshMe({ quiet: true });
      }
    } catch {
      setError(campErrorCopy("camp_ai_invalid_response"));
    } finally {
      setSending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const text = draft.trim();
    if (!text) return;
    const id = pendingClientMessageId ?? newClientMessageId();
    await submitTurn(id, text);
  }

  function onRetry() {
    if (sending) return;
    const text = draft.trim();
    if (!text || !pendingClientMessageId) return;
    void submitTurn(pendingClientMessageId, text);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  if (!privyReady || loading) {
    return (
      <div className="camp-talk" aria-live="polite">
        <p className="muted camp-talk__loading">the fire is settling...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="camp-talk">
        <p>ENTRY IS REQUIRED AT THE FIRE.</p>
        <p>
          <button type="button" className="btn-text" onClick={() => login()}>
            [ enter ]
          </button>
        </p>
      </div>
    );
  }

  if (profileLoading || !profileResolved) {
    return (
      <div className="camp-talk" aria-live="polite">
        <p className="muted camp-talk__loading">the fire is settling...</p>
      </div>
    );
  }

  if (!registered || !profile) {
    return (
      <div className="camp-talk">
        <p>THE FIRE DOES NOT KNOW YOUR NAME.</p>
        <p>
          <Link href="/#outlaw-register" className="btn-text">
            [ register ]
          </Link>
        </p>
      </div>
    );
  }

  // Failures of progress fetch must not invent onboarding or break CAMP.
  const showActivePanel = shouldShowActiveFirstThirty(progress);
  const showOpen = shouldShowGreenwoodOpenAction(progress);

  return (
    <div className="camp-talk">
      {showActivePanel && progress ? (
        <div className="camp-talk__ft-header">
          <FirstThirtyProgressPanel progress={progress} variant="compact" />
        </div>
      ) : null}
      {showOpen && progress ? (
        <div className="camp-talk__ft-header">
          <FirstThirtyProgressPanel progress={progress} />
        </div>
      ) : null}

      <div
        className="camp-talk__transcript"
        ref={transcriptRef}
        aria-live="polite"
      >
        {messages === null ? (
          <p className="muted camp-talk__loading">recalling the fire...</p>
        ) : messages.length === 0 ? (
          <p className="muted camp-talk__empty">{emptyPrompt}</p>
        ) : (
          <>
            {hasOlderMessages ? (
              <p className="muted camp-talk__older">
                older words remain in the wood.
              </p>
            ) : null}
            {messages.map((message) => (
              <div key={message.id}>
                <div
                  className={
                    message.role === "assistant"
                      ? `camp-talk__turn camp-talk__turn--${characterId}`
                      : "camp-talk__turn camp-talk__turn--you"
                  }
                >
                  <p className="camp-talk__label">
                    {message.role === "assistant" ? characterName : outlawLabel}
                  </p>
                  <p className="camp-talk__body">{message.content}</p>
                  {message.role === "assistant" &&
                  message.rewardGranted &&
                  message.rewardGranted > 0 ? (
                    <p className="camp-talk__reward">
                      +{message.rewardGranted}{" "}
                      <span className="camp-leaf">LEAF</span>
                    </p>
                  ) : null}
                </div>
                {reveal &&
                message.role === "assistant" &&
                message.id === reveal.afterMessageId ? (
                  <FirstThirtyAcknowledge
                    event={reveal.event}
                    progress={reveal.progress}
                    eventKey={reveal.eventKey}
                  />
                ) : null}
              </div>
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      {quietNote ? (
        <p className="camp-talk__ft-quiet" role="status">
          {quietNote.split("\n").map((line) => (
            <span key={line} className="camp-talk__ft-quiet-line">
              {line}
            </span>
          ))}
        </p>
      ) : null}

      {ineligibleHint ? (
        <p className="muted camp-talk__ft-ineligible">{FIRST_THIRTY_INELIGIBLE_COPY}</p>
      ) : null}

      {countFailure ? (
        <div className="camp-talk__ft-fail" role="status">
          <p>{FIRST_THIRTY_FAILURE_COPY.line1}</p>
          <p>{FIRST_THIRTY_FAILURE_COPY.line2}</p>
        </div>
      ) : null}

      {showActivePanel && progress ? (
        <FirstThirtyProgressPanel progress={progress} variant="panel" />
      ) : null}

      {error ? (
        <div className="camp-talk__error">
          <p>{error}</p>
          {pendingClientMessageId ? (
            <p>
              <button
                type="button"
                className="btn-text"
                onClick={onRetry}
                disabled={sending}
              >
                [ try again ]
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      <form className="camp-talk__form" onSubmit={onSubmit}>
        <label className="camp-talk__composer">
          <span className="visually-hidden">speak to {characterName}</span>
          <textarea
            className="camp-talk__input"
            name="message"
            rows={3}
            maxLength={CAMP_USER_MESSAGE_MAX_CHARS}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            disabled={sending}
            placeholder="write something..."
            autoComplete="off"
            enterKeyHint="send"
          />
        </label>
        <p className="camp-talk__actions">
          <button
            type="submit"
            className="btn-text"
            disabled={sending || !draft.trim()}
            aria-busy={sending || undefined}
          >
            {sending ? "the fire is listening..." : "[ speak ]"}
          </button>
        </p>
        <p className="muted camp-talk__hint">ctrl/cmd + enter to speak</p>
      </form>
    </div>
  );
}
