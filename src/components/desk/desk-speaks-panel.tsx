"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { OperatorFireMessage } from "@/lib/greenwood/fire-messages/types";

type SpeaksPayload = {
  current: OperatorFireMessage | null;
  recent: OperatorFireMessage[];
};

export function DeskSpeaksPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [speaks, setSpeaks] = useState<SpeaksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open FENN SPEAKS.");
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
      setError(data.error ?? "FENN SPEAKS could not be loaded.");
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

  async function createDraft() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch("/api/desk/speaks", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        cache: "no-store",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Draft could not be saved.");
        return;
      }
      setBody("");
      setStatus("Draft saved.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publish(id: string) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function archiveDraft(id: string) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <section className="desk-speaks" aria-label="FENN SPEAKS">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">FENN SPEAKS</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">
        One current message at The Fire. Publish a new draft to replace it.
        Published words are not silently edited.
      </p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <h3 className="desk-overview__group-title">CURRENT</h3>
      {speaks?.current ? (
        <pre className="ascii desk-speaks__current">{speaks.current.body}</pre>
      ) : (
        <p className="muted">No published message.</p>
      )}

      <h3 className="desk-overview__group-title">NEW DRAFT</h3>
      <form
        className="desk-gatherings__form"
        onSubmit={(e) => {
          e.preventDefault();
          void createDraft();
        }}
      >
        <label className="desk-register__field">
          Message
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            required
            aria-label="FENN SPEAKS draft body"
          />
        </label>
        <button type="submit" className="btn-text" disabled={busy || !body.trim()}>
          [ save draft ]
        </button>
      </form>

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
                        onClick={() => void publish(item.id)}
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
