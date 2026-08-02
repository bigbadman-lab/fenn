"use client";

import { useCallback, useEffect, useState } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type { OperatorFireMessage } from "@/lib/greenwood/fire-messages/types";

type SpeaksPayload = {
  current: OperatorFireMessage | null;
  recent: OperatorFireMessage[];
};

/**
 * Minimal Admin fallback for FENN SPEAKS.
 * Same domain helpers as Desk; independently gated by FENN_ADMIN_WALLETS.
 */
export function AdminSpeaksBoard() {
  const { getAuthHeaders, authenticated, loading } = useFennAuth();
  const [speaks, setSpeaks] = useState<SpeaksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Admin session required.");
      return;
    }
    const response = await fetch("/api/admin/greenwood/speaks", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      speaks?: SpeaksPayload;
      error?: string;
    };
    if (!response.ok || !data.speaks) {
      setError(data.error ?? "Could not load FENN SPEAKS.");
      setSpeaks(null);
      return;
    }
    setSpeaks(data.speaks);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (loading || !authenticated) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, loading, load]);

  async function createAndPublish() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const createRes = await fetch("/api/admin/greenwood/speaks", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        cache: "no-store",
      });
      const createData = (await createRes.json()) as {
        error?: string;
        message?: OperatorFireMessage;
      };
      if (!createRes.ok || !createData.message) {
        setError(createData.error ?? "Draft failed.");
        return;
      }
      const publishRes = await fetch(
        `/api/admin/greenwood/speaks/${createData.message.id}/publish`,
        { method: "POST", headers, cache: "no-store" },
      );
      const publishData = (await publishRes.json()) as { error?: string };
      if (!publishRes.ok) {
        setError(publishData.error ?? "Publish failed.");
        await load();
        return;
      }
      setBody("");
      setStatus("Published.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Admin FENN SPEAKS">
      <h1>FENN SPEAKS</h1>
      <p className="muted">Admin fallback. Desk is the primary operator surface.</p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <h2>Current</h2>
      {speaks?.current ? (
        <pre className="ascii">{speaks.current.body}</pre>
      ) : (
        <p className="muted">None published.</p>
      )}

      <h2>Publish new</h2>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        maxLength={2000}
        aria-label="New FENN SPEAKS message"
      />
      <p>
        <button
          type="button"
          className="btn-text"
          disabled={busy || !body.trim()}
          onClick={() => void createAndPublish()}
        >
          [ create and publish ]
        </button>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </p>

      <h2>Recent</h2>
      <ul>
        {(speaks?.recent ?? []).map((item) => (
          <li key={item.id}>
            [{item.status}] {item.preview}
          </li>
        ))}
      </ul>
    </section>
  );
}
