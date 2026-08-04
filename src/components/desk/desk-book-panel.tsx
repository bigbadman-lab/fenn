"use client";

import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskBookHealth } from "@/lib/desk/book";

/** e.g. 2026-08-03 → "3 August 2026" (UTC calendar date). */
function formatBookDayLabel(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return isoDate;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  if (m < 1 || m > 12 || d < 1 || d > 31) return isoDate;
  return `${d} ${months[m - 1]} ${y}`;
}

function mapGenerateError(error: string | undefined, status: number): string {
  if (status === 401 || status === 403 || error === "forbidden") {
    return "Keeper access is required.";
  }
  if (!error) return "FENN could not complete this step.";
  const lower = error.toLowerCase();
  if (
    lower.includes("schema cache") ||
    lower.includes("column of") ||
    lower.includes("postgrest") ||
    /source_external|pgrst/i.test(lower)
  ) {
    return "FENN could not write this entry to the Book.";
  }
  return error;
}

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
      setError("Keeper access is required.");
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
      code?: string;
    };
    if (!response.ok || !data.book) {
      setError(
        mapGenerateError(
          data.error ?? "The Book could not be opened.",
          response.status,
        ),
      );
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
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }
      setStatus("FENN is writing…");
      const response = await fetch("/api/desk/book/generate", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ coveredDate: generateDate, confirm: true }),
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        result?: { mode?: string; created?: boolean; existed?: boolean };
      };
      if (!response.ok) {
        setStatus(null);
        setError(mapGenerateError(data.error, response.status));
        return;
      }
      if (data.result?.mode === "already_exists" || data.result?.existed) {
        setStatus("Already written");
      } else if (data.result?.created) {
        setStatus("Entry written");
      } else {
        setStatus("Already written");
      }
      setConfirmGenerate(false);
      await load();
    } catch {
      setStatus(null);
      setError("FENN could not complete this step.");
    } finally {
      setBusy(false);
    }
  }

  const yesterdayLabel = book
    ? formatBookDayLabel(book.yesterday.coveredDate)
    : "";
  const selectedLabel = generateDate
    ? formatBookDayLabel(generateDate)
    : "";
  const isYesterday =
    Boolean(book) && generateDate === book!.yesterday.coveredDate;

  return (
    <section className="desk-book" aria-label="The Book">
      <div className="desk-hollow__head">
        <h2 className="desk-section-title">THE BOOK</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      <p className="muted">Did FENN write yesterday’s history?</p>
      <p className="muted desk-book__note">
        The Book records each completed UTC day.
      </p>
      {status ? (
        <p className="desk-book__status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="muted" role="alert">
          {error}
        </p>
      ) : null}
      {!book && !error ? <p className="muted">…</p> : null}
      {book ? (
        <>
          <h3 className="desk-overview__group-title">YESTERDAY</h3>
          <p>
            {formatBookDayLabel(book.yesterday.coveredDate)}
            {" · "}
            {book.yesterday.state === "written" ? "Written" : "Missing"}
          </p>
          <p className="muted">{book.yesterday.coveredDate}</p>

          <h3 className="desk-overview__group-title">LATEST ENTRY</h3>
          {book.latest ? (
            <ul className="desk-member__facts">
              <li>
                {book.latest.coveredDate
                  ? formatBookDayLabel(book.latest.coveredDate)
                  : "—"}{" "}
                · {book.latest.kind}
              </li>
              <li>{book.latest.title ?? "(untitled)"}</li>
              <li className="muted">{book.latest.preview}</li>
            </ul>
          ) : (
            <p className="muted">No entries yet.</p>
          )}

          <h3 className="desk-overview__group-title">RECENT DAYS</h3>
          <ul className="desk-member__list">
            {book.recentDays.map((d) => (
              <li key={d.coveredDate}>
                <span>
                  {formatBookDayLabel(d.coveredDate)}
                  {" · "}
                  {d.state === "written" ? "Written" : "Missing"}
                </span>
                {d.state === "missing" ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn-text"
                      disabled={busy}
                      onClick={() => {
                        setGenerateDate(d.coveredDate);
                        setConfirmGenerate(true);
                        setError(null);
                        setStatus(null);
                      }}
                    >
                      [ choose ]
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted">
            Missing in this window: {book.gapCount}
          </p>

          <h3 className="desk-overview__group-title">DAILY WRITING</h3>
          <p className="muted">{book.cronHint}</p>

          <h3 className="desk-overview__group-title">
            {isYesterday || !generateDate
              ? "WRITE YESTERDAY’S ENTRY"
              : "WRITE THIS ENTRY"}
          </h3>
          {!confirmGenerate ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                if (!generateDate) {
                  setGenerateDate(book.yesterday.coveredDate);
                }
                setConfirmGenerate(true);
                setError(null);
                setStatus(null);
              }}
            >
              [ prepare generation ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>
                FENN will gather the world’s activity and compose the entry for{" "}
                {selectedLabel || yesterdayLabel}.
              </p>
              <p className="muted">
                This will only create an entry if that day is still missing. It
                will not overwrite an existing page.
              </p>
              <label className="desk-register__field">
                Covered date
                <input
                  value={generateDate}
                  onChange={(e) => setGenerateDate(e.target.value)}
                  disabled={busy}
                  aria-label="Covered date YYYY-MM-DD"
                />
              </label>
              <p className="muted">Use YYYY-MM-DD (UTC calendar day).</p>
              <button
                type="button"
                className="btn-text"
                disabled={busy || !generateDate}
                onClick={() => void generate()}
              >
                [ Generate with FENN ]
              </button>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => {
                  setConfirmGenerate(false);
                  setStatus(null);
                }}
              >
                [ Cancel ]
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
