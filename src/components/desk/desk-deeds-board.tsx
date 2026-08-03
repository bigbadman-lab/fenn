"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskDeedListItem,
  DeskDeedStatusFilter,
} from "@/lib/desk/deeds-types";

export function DeskDeedsBoard() {
  const { getAuthHeaders } = useDeskGate();
  const [status, setStatus] = useState<DeskDeedStatusFilter>("pending");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [items, setItems] = useState<DeskDeedListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open Deeds.");
      setItems([]);
      return;
    }
    const params = new URLSearchParams({
      status,
      sort,
      page: "1",
      limit: "25",
    });
    const response = await fetch(`/api/desk/deeds/submissions?${params}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      submissions?: DeskDeedListItem[];
      total?: number;
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "Could not load submissions.");
      setItems([]);
      return;
    }
    setItems(data.submissions ?? []);
    setTotal(data.total ?? 0);
  }, [getAuthHeaders, sort, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="desk-deeds" aria-label="Deed submissions">
      <div className="desk-hollow__head">
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>
      {error ? <p className="muted">{error}</p> : null}

      <div className="desk-register__filters">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={
              status === s ? "btn-text desk-hollow__filter--active" : "btn-text"
            }
            onClick={() => setStatus(s)}
          >
            [{s}]
          </button>
        ))}
        <button
          type="button"
          className="btn-text"
          onClick={() => setSort((v) => (v === "oldest" ? "newest" : "oldest"))}
        >
          [ {sort} ]
        </button>
      </div>

      {items === null ? (
        <p className="muted">…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {status === "pending" ? "No pending submissions." : "No submissions."}
        </p>
      ) : (
        <>
          <p className="muted">{total} in view filter.</p>
          <ul className="desk-member__list">
            {items.map((item) => (
              <li key={item.submissionId}>
                {item.sigil ? (
                  <pre
                    className="ascii desk-register__sigil"
                    aria-label={item.sigil.a11yLabel}
                  >
                    {item.sigil.asciiBody}
                  </pre>
                ) : null}
                <Link
                  href={`/desk/deeds/${item.submissionId}`}
                  className="desk-register__name"
                >
                  {item.deedTitle}
                </Link>
                {" · "}
                {item.displayName} · {item.status} · {item.rewardLabel} ·{" "}
                {item.ageLabel}
                {item.greenwoodOnly ? " · Greenwood" : ""}
                {item.hasImageEvidence ? " · image" : ""}
                {item.wallShared ? " · WALL" : ""}
                {" · "}
                <Link
                  href={`/desk/register/${item.profileId}`}
                  className="btn-text"
                >
                  [ register ]
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
