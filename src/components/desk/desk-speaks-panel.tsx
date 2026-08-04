"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import { GREENWOOD_FIRE_MESSAGE_MAX_CHARS } from "@/lib/greenwood/fire-message";
import type { OperatorFireMessage } from "@/lib/greenwood/fire-messages/types";

type SpeaksPayload = {
  current: OperatorFireMessage | null;
  recent: OperatorFireMessage[];
};

function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

export function DeskSpeaksPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [speaks, setSpeaks] = useState<SpeaksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /** Keeper plain-language source; frozen after first successful transform. */
  const [originalMessage, setOriginalMessage] = useState("");
  /** Editable text destined for publish (original and/or FENN version). */
  const [editableMessage, setEditableMessage] = useState("");
  const [lastTransformed, setLastTransformed] = useState<string | null>(null);
  const [hasTransformed, setHasTransformed] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [busyArchive, setBusyArchive] = useState(false);
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);
  const [confirmPublishNow, setConfirmPublishNow] = useState(false);

  const busy = generating || publishing || busyArchive;

  function clearDraftState() {
    setOriginalMessage("");
    setEditableMessage("");
    setLastTransformed(null);
    setHasTransformed(false);
    setConfirmPublishNow(false);
  }

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Keeper access is required.");
      setSpeaks(null);
      return;
    }
    const response = await fetch("/api/desk/speaks", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      speaks?: SpeaksPayload;
      error?: string;
    };
    if (!response.ok || !data.speaks) {
      setError(
        data.error === "forbidden"
          ? "Keeper access is required."
          : (data.error ?? "FENN SPEAKS could not be loaded."),
      );
      setSpeaks(null);
      return;
    }
    setSpeaks(data.speaks);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function onComposeChange(value: string) {
    if (hasTransformed) return;
    setOriginalMessage(value);
    setEditableMessage(value);
  }

  async function transform() {
    const source = originalMessage.trim()
      ? originalMessage
      : editableMessage;
    if (!source.trim()) return;

    setGenerating(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }
      // Always transform from original when set; first time freeze source.
      const messageForModel = originalMessage.trim()
        ? originalMessage
        : source;
      if (!originalMessage.trim()) {
        setOriginalMessage(messageForModel);
      }

      const response = await fetch("/api/desk/speaks/transform", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageForModel }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        transformedMessage?: string;
        error?: string;
      };
      if (!response.ok || !data.transformedMessage) {
        setError(
          data.error === "forbidden"
            ? "Keeper access is required."
            : (data.error ?? "FENN could not shape these words."),
        );
        return;
      }
      setHasTransformed(true);
      setLastTransformed(data.transformedMessage);
      setEditableMessage(data.transformedMessage);
      setStatus(null);
    } catch {
      setError("The words remain yours. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  function useOriginal() {
    setEditableMessage(originalMessage);
    setError(null);
    setStatus(null);
  }

  async function publishEditable() {
    const body = editableMessage.trim()
      ? editableMessage
      : originalMessage;
    if (!body.trim()) return;

    setPublishing(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }

      const createRes = await fetch("/api/desk/speaks", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        cache: "no-store",
      });
      const createData = (await createRes.json()) as {
        ok?: boolean;
        message?: { id: string };
        error?: string;
      };
      if (!createRes.ok || !createData.message?.id) {
        setError(createData.error ?? "Message could not be prepared.");
        return;
      }

      const publishRes = await fetch(
        `/api/desk/speaks/${createData.message.id}/publish`,
        {
          method: "POST",
          headers,
          cache: "no-store",
        },
      );
      const publishData = (await publishRes.json()) as {
        error?: string;
        result?: { status?: string };
      };
      if (!publishRes.ok) {
        setError(publishData.error ?? "Publish failed.");
        await load();
        return;
      }

      clearDraftState();
      setStatus(
        publishData.result?.status === "already_published"
          ? "Already published."
          : "Published to The Fire.",
      );
      await load();
    } catch {
      setError("Publish failed.");
    } finally {
      setPublishing(false);
      setConfirmPublishNow(false);
    }
  }

  async function publishDraft(id: string) {
    setBusyArchive(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/desk/speaks/${id}/publish`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        result?: { status?: string };
      };
      if (!response.ok) {
        setError(data.error ?? "Publish failed.");
        return;
      }
      setConfirmPublishId(null);
      setStatus(
        data.result?.status === "already_published"
          ? "Already published."
          : "Published to The Fire.",
      );
      await load();
    } finally {
      setBusyArchive(false);
    }
  }

  async function archiveDraft(id: string) {
    setBusyArchive(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/desk/speaks/${id}/archive`, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Archive failed.");
        return;
      }
      setStatus("Draft archived.");
      await load();
    } finally {
      setBusyArchive(false);
    }
  }

  const composeValue = hasTransformed ? originalMessage : editableMessage;
  const publishValue = hasTransformed ? editableMessage : editableMessage || originalMessage;
  const canTransform = !busy && composeValue.trim().length > 0;
  const canPublish = !busy && publishValue.trim().length > 0;
  const charCount = (hasTransformed ? editableMessage : composeValue).length;

  return (
    <section className="desk-speaks" aria-label="FENN SPEAKS">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">FENN SPEAKS</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">
        One current message at The Fire. Publish replaces it. Published words are
        not silently edited.
      </p>
      {status ? (
        <p className="desk-speaks__status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="muted" role="alert">
          {error}
        </p>
      ) : null}

      <h3 className="desk-overview__group-title">CURRENT MESSAGE</h3>
      {speaks?.current ? (
        <pre className="ascii desk-speaks__current">{speaks.current.body}</pre>
      ) : (
        <p className="muted">No published message.</p>
      )}

      <h3 className="desk-overview__group-title">WRITE THE NEXT MESSAGE</h3>
      <p className="muted desk-speaks__hint">
        Write plainly. FENN will shape the words, not change their meaning.
      </p>

      {!hasTransformed ? (
        <div className="desk-speaks__compose">
          <label className="desk-register__field">
            What should FENN say?
            <textarea
              value={composeValue}
              onChange={(e) => onComposeChange(e.target.value)}
              rows={6}
              maxLength={GREENWOOD_FIRE_MESSAGE_MAX_CHARS}
              disabled={busy}
              aria-label="Plain FENN SPEAKS message"
            />
          </label>
          <p className="muted desk-speaks__count">
            {formatCount(charCount)} / {formatCount(GREENWOOD_FIRE_MESSAGE_MAX_CHARS)}
          </p>
          <div className="desk-gatherings__actions">
            <button
              type="button"
              className="btn-text"
              disabled={!canTransform}
              onClick={() => void transform()}
            >
              {generating ? "[ shaping… ]" : "[ Turn into FENN Speak ]"}
            </button>
            {!confirmPublishNow ? (
              <button
                type="button"
                className="desk-deed-write__btn desk-deed-write__btn--primary"
                disabled={!canPublish}
                onClick={() => setConfirmPublishNow(true)}
              >
                Publish
              </button>
            ) : (
              <div className="desk-gatherings__confirm">
                <p>PUBLISH THIS MESSAGE</p>
                <p className="muted">
                  This will replace the current message at The Fire.
                </p>
                <button
                  type="button"
                  className="desk-deed-write__btn desk-deed-write__btn--primary"
                  disabled={busy}
                  onClick={() => void publishEditable()}
                >
                  Confirm publish
                </button>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => setConfirmPublishNow(false)}
                >
                  [ cancel ]
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="desk-speaks__review">
          <p className="muted desk-speaks__source-label">Your words (kept)</p>
          <pre className="ascii desk-speaks__source">{originalMessage}</pre>

          <h4 className="desk-overview__group-title">FENN&apos;S VERSION</h4>
          <p className="muted">
            Review every word before it enters the Greenwood.
          </p>
          <label className="desk-register__field">
            Editable message
            <textarea
              value={editableMessage}
              onChange={(e) => setEditableMessage(e.target.value)}
              rows={8}
              maxLength={GREENWOOD_FIRE_MESSAGE_MAX_CHARS}
              disabled={busy}
              aria-label="FENN SPEAKS version to publish"
            />
          </label>
          <p className="muted desk-speaks__count">
            {formatCount(editableMessage.length)} /{" "}
            {formatCount(GREENWOOD_FIRE_MESSAGE_MAX_CHARS)}
          </p>
          <div className="desk-gatherings__actions">
            <button
              type="button"
              className="btn-text"
              disabled={!canTransform || !originalMessage.trim()}
              onClick={() => void transform()}
            >
              {generating ? "[ shaping… ]" : "[ Try Again ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => useOriginal()}
            >
              [ Use Original ]
            </button>
          </div>
          <div className="desk-gatherings__actions">
            {!confirmPublishNow ? (
              <button
                type="button"
                className="desk-deed-write__btn desk-deed-write__btn--primary"
                disabled={!canPublish}
                onClick={() => setConfirmPublishNow(true)}
              >
                Publish
              </button>
            ) : (
              <div className="desk-gatherings__confirm">
                <p>PUBLISH THIS MESSAGE</p>
                <p className="muted">
                  This will replace the current message at The Fire.
                </p>
                <button
                  type="button"
                  className="desk-deed-write__btn desk-deed-write__btn--primary"
                  disabled={busy}
                  onClick={() => void publishEditable()}
                >
                  Confirm publish
                </button>
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => setConfirmPublishNow(false)}
                >
                  [ cancel ]
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <h3 className="desk-overview__group-title">RECENT</h3>
      {!speaks ? (
        <p className="muted">…</p>
      ) : speaks.recent.length === 0 ? (
        <p className="muted">No messages yet.</p>
      ) : (
        <ul className="desk-member__list">
          {speaks.recent.map((item) => (
            <li key={item.id}>
              <p>
                [{item.status}] {item.preview}
              </p>
              <p className="muted">
                created {item.createdAt}
                {item.publishedAt ? ` · published ${item.publishedAt}` : ""}
              </p>
              {item.status === "draft" ? (
                <p className="desk-gatherings__actions">
                  {confirmPublishId === item.id ? (
                    <>
                      <span>PUBLISH THIS MESSAGE</span>
                      <button
                        type="button"
                        className="btn-text"
                        disabled={busy}
                        onClick={() => void publishDraft(item.id)}
                      >
                        [ confirm publish ]
                      </button>
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => setConfirmPublishId(null)}
                      >
                        [ cancel ]
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-text"
                        disabled={busy}
                        onClick={() => setConfirmPublishId(item.id)}
                      >
                        [ publish ]
                      </button>
                      <button
                        type="button"
                        className="btn-text"
                        disabled={busy}
                        onClick={() => void archiveDraft(item.id)}
                      >
                        [ archive draft ]
                      </button>
                    </>
                  )}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
