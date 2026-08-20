"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import { formatWallInscriptionTime } from "@/lib/wall/format";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import type { PublicWallEntry } from "@/lib/wall/types";

export function DeskWallPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [entries, setEntries] = useState<PublicWallEntry[] | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Keeper access is required.");
      setEntries(null);
      return;
    }
    const response = await fetch("/api/desk/wall", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      entries?: PublicWallEntry[];
      error?: string;
    };
    if (!response.ok || !data.entries) {
      setError(
        data.error === "forbidden"
          ? "Keeper access is required."
          : (data.error ?? "The Wall could not be read."),
      );
      setEntries(null);
      return;
    }
    setEntries(data.entries);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function inscribe() {
    const body = draft.trim();
    if (!body || posting) return;

    setPosting(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }
      const response = await fetch("/api/desk/wall", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        created?: boolean;
        wallPath?: string;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setError(
          data.error === "forbidden"
            ? "Keeper access is required."
            : (data.error ?? "The inscription could not be left."),
        );
        return;
      }
      setDraft("");
      setConfirming(false);
      setStatus("Inscription left on The Wall.");
      await load();
    } catch {
      setError("The Wall did not take the words. Try again.");
    } finally {
      setPosting(false);
    }
  }

  const canPost = !posting && draft.trim().length > 0;

  return (
    <section className="desk-wall" aria-label="The Wall">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE WALL</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">
        Words left here appear on the public Wall as VELL’s hand.
        <br />
        The road still reads: only VELL writes here.
      </p>
      <p className="muted desk-wall__hint">
        <Link href="/wall" className="btn-text">
          [ open the wall ]
        </Link>
      </p>

      {status ? (
        <p className="desk-wall__status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="muted" role="alert">
          {error}
        </p>
      ) : null}

      <h3 className="desk-overview__group-title">LEAVE AN INSCRIPTION</h3>
      <p className="muted desk-wall__hint">
        Plain text only. No HTML. These words stay.
      </p>
      <div className="desk-wall__compose">
        <label className="visually-hidden" htmlFor="desk-wall-body">
          Wall inscription
        </label>
        <textarea
          id="desk-wall-body"
          className="desk-wall__textarea"
          rows={8}
          maxLength={WALL_BODY_MAX_CHARS}
          value={draft}
          disabled={posting}
          onChange={(event) => {
            setDraft(event.target.value);
            setConfirming(false);
            setStatus(null);
          }}
          placeholder="what the wood should remember…"
        />
        <p className="muted desk-wall__count">
          {draft.length} / {WALL_BODY_MAX_CHARS}
        </p>
        {!confirming ? (
          <button
            type="button"
            className="btn-text"
            disabled={!canPost}
            onClick={() => setConfirming(true)}
          >
            [ leave on the wall ]
          </button>
        ) : (
          <div className="desk-wall__confirm">
            <p>These words will stand on The Wall. Confirm?</p>
            <button
              type="button"
              className="btn-text"
              disabled={posting}
              onClick={() => void inscribe()}
            >
              {posting ? "[ leaving… ]" : "[ confirm inscription ]"}
            </button>
            <button
              type="button"
              className="btn-text"
              disabled={posting}
              onClick={() => setConfirming(false)}
            >
              [ hold ]
            </button>
          </div>
        )}
      </div>

      <h3 className="desk-overview__group-title">RECENT ON THE WALL</h3>
      {entries == null ? (
        <p className="muted">reading…</p>
      ) : entries.length === 0 ? (
        <p className="muted">the wall is bare.</p>
      ) : (
        <ul className="desk-wall__list">
          {entries.map((entry) => (
            <li key={entry.id} className="desk-wall__item">
              <p className="muted desk-wall__time">
                {formatWallInscriptionTime(entry.createdAt)}
                {entry.markCount > 0
                  ? ` · ${entry.markCount.toLocaleString("en-GB")} marks`
                  : ""}
              </p>
              <pre className="ascii desk-wall__body">{entry.body}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
