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
import { CAMP_USER_MESSAGE_MAX_CHARS } from "@/lib/camp/config";
import { campErrorCopy } from "@/lib/camp/errors";
import type { SafeCampMessage } from "@/lib/camp/dto";
import { formatOutlawNumber } from "@/lib/profiles/types";

type CampConversationProps = {
  characterId: CampCharacterId;
  characterName: string;
};

type ConversationResponse = {
  ok?: boolean;
  conversation?: {
    messages: SafeCampMessage[];
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

  const [messages, setMessages] = useState<SafeCampMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingClientMessageId, setPendingClientMessageId] = useState<
    string | null
  >(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const outlawLabel = profile
    ? `OUTLAW ${formatOutlawNumber(profile.outlawNumber)}`
    : "YOU";

  const loadConversation = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setMessages([]);
      return;
    }
    const response = await fetch(`/api/camp/${characterId}/messages`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as ConversationResponse;
    if (!response.ok) {
      setMessages([]);
      setError(campErrorCopy(data.code ?? "internal_error"));
      return;
    }
    setMessages(data.conversation?.messages ?? []);
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
  }, [messages]);

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
        <p className="muted">...</p>
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
        <p className="muted">...</p>
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

  return (
    <div className="camp-talk">
      <div
        className="camp-talk__transcript"
        ref={transcriptRef}
        aria-live="polite"
      >
        {messages === null ? (
          <p className="muted">...</p>
        ) : messages.length === 0 ? (
          <p className="muted camp-talk__empty">the fire waits.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
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
          ))
        )}
        <div ref={endRef} />
      </div>

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
