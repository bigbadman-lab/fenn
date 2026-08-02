"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskBookHealth } from "@/lib/desk/book";

export function DeskBookPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [book, setBook] = useState<DeskBookHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generateDate, setGenerateDate] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open The Book.");
      setBook(null);
      return;
    }
    const response = await fetch("/api/desk/book", {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      book?: DeskBookHealth;
      error?: string;
    };
    if (!response.ok || !data.book) {
      setError(data.error ?? "Book health could not be loaded.");
      setBook(null);
      return;
    }
    setBook(data.book);
    setGenerateDate((prev) => prev || data.book!.yesterday.coveredDate);
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function generate() {
    if (!generateDate || !confirmGenerate) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch("/api/desk/book/generate", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ coveredDate: generateDate, confirm: true }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        result?: { mode?: string; created?: boolean };
      };
      if (!response.ok) {
        setError(data.error ?? "Generation failed.");
        return;
      }
      setStatus(
        data.result?.mode === "already_exists"
          ? "Entry already exists. Nothing was overwritten."
          : data.result?.created
            ? "Entry written."
            : "Generation finished.",
      );
      setConfirmGenerate(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="desk-book" aria-label="The Book">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE BOOK</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">Did the world write its history?</p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      {!book && !error ? <p className="muted">…</p> : null}
      {book ? (
        <>
          <h3 className="desk-overview__group-title">YESTERDAY</h3>
          <p>
            {book.yesterday.coveredDate}:{" "}
            {book.yesterday.state === "written" ? "WRITTEN" : "MISSING"}
          </p>

          <h3 className="desk-overview__group-title">LATEST ENTRY</h3>
          {book.latest ? (
            <ul className="desk-member__facts">
              <li>
                {book.latest.coveredDate ?? "—"} · {book.latest.kind}
              </li>
              <li>{book.latest.title ?? "(untitled)"}</li>
              <li className="muted">{book.latest.preview}</li>
              <li>Published: {book.latest.publishedAt}</li>
            </ul>
          ) : (
            <p className="muted">No entries.</p>
          )}

          <h3 className="desk-overview__group-title">RECENT DAYS</h3>
          <ul className="desk-member__list">
            {book.recentDays.map((d) => (
              <li key={d.coveredDate}>
                {d.coveredDate}: {d.state === "written" ? "written" : "missing"}
              </li>
            ))}
          </ul>
          <p className="muted">Gaps in window: {book.gapCount}</p>

          <h3 className="desk-overview__group-title">CRON</h3>
          <p className="muted">{book.cronHint}</p>

          <h3 className="desk-overview__group-title">GENERATE (FILL IF MISSING)</h3>
          {!confirmGenerate ? (
            <button
              type="button"
              className="btn-text"
              onClick={() => setConfirmGenerate(true)}
            >
              [ prepare generation ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>WRITE THE MISSING ENTRY</p>
              <p className="muted">
                Covered date {generateDate || "—"}. Creates a daily entry only
                if none exists. Will not overwrite an existing entry.
              </p>
              <label className="desk-register__field">
                Covered date (UTC)
                <input
                  value={generateDate}
                  onChange={(e) => setGenerateDate(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void generate()}
              >
                [ confirm write ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmGenerate(false)}
              >
                [ cancel ]
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
