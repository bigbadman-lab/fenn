"use client";

import { useCallback, useState } from "react";

import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";

type ApiOk = { replyText: string };
type ApiErr = { ok?: false; error?: string };

export function VellXReplyTerminal() {
  const [incoming, setIncoming] = useState("");
  const [username, setUsername] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopyState("idle");
    try {
      const response = await fetch("/api/dev/vell-x-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: incoming,
          username: username.trim().length > 0 ? username.trim() : undefined,
        }),
      });
      const data = (await response.json()) as ApiOk & ApiErr;
      if (!response.ok) {
        setError(data.error ?? `Request failed (${response.status})`);
        return;
      }
      if (typeof data.replyText !== "string" || data.replyText.trim().length === 0) {
        setError("No reply returned.");
        return;
      }
      setReply(data.replyText);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [incoming, username]);

  async function onCopy() {
    if (!reply.trim()) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("fail");
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  const count = reply.length;
  const over = count > STAGE12_X_REPLY_MAX_CHARS;

  return (
    <div className="vell-x-reply">
      <header className="vell-x-reply__head">
        <p className="vell-x-reply__kicker">VELL // X REPLY TERMINAL</p>
        <p className="vell-x-reply__note muted">
          Local only · paste · generate · copy into X · never posts
        </p>
      </header>

      <label className="vell-x-reply__label" htmlFor="vell-x-incoming">
        INCOMING
      </label>
      <textarea
        id="vell-x-incoming"
        className="vell-x-reply__incoming"
        value={incoming}
        onChange={(e) => setIncoming(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder="Paste the X mention or reply…"
        disabled={loading}
      />

      <label className="vell-x-reply__label" htmlFor="vell-x-username">
        @USERNAME <span className="muted">(optional)</span>
      </label>
      <input
        id="vell-x-username"
        className="vell-x-reply__username"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="@handle"
        autoComplete="off"
        spellCheck={false}
        disabled={loading}
      />

      <div className="vell-x-reply__actions">
        <button
          type="button"
          className="btn-text"
          onClick={() => void generate()}
          disabled={loading || incoming.trim().length === 0}
        >
          {loading ? "[ generating… ]" : "[ GENERATE ]"}
        </button>
      </div>

      {error ? (
        <p className="vell-x-reply__error" role="alert">
          {error}
        </p>
      ) : null}

      <label className="vell-x-reply__label" htmlFor="vell-x-reply-out">
        VELL
      </label>
      <textarea
        id="vell-x-reply-out"
        className="vell-x-reply__outgoing"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder="Generated reply appears here…"
        disabled={loading}
      />

      <p
        className={
          over
            ? "vell-x-reply__count vell-x-reply__count--over"
            : "vell-x-reply__count muted"
        }
      >
        {count} / {STAGE12_X_REPLY_MAX_CHARS}
      </p>

      <div className="vell-x-reply__actions">
        <button
          type="button"
          className="btn-text"
          onClick={() => void onCopy()}
          disabled={loading || reply.trim().length === 0}
        >
          [ COPY ]
        </button>
        <button
          type="button"
          className="btn-text"
          onClick={() => void generate()}
          disabled={loading || incoming.trim().length === 0}
        >
          [ AGAIN ]
        </button>
        {copyState === "ok" ? (
          <span className="muted">copied.</span>
        ) : copyState === "fail" ? (
          <span className="muted">copy failed.</span>
        ) : null}
      </div>
    </div>
  );
}
