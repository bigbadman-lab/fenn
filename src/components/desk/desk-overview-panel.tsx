"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskAttentionCategory,
  DeskAttentionSignal,
  DeskOverviewSnapshot,
} from "@/lib/desk/overview-types";

const CATEGORY_LABEL: Record<DeskAttentionCategory, string> = {
  needs_attention: "NEEDS ATTENTION",
  happening_now: "HAPPENING NOW",
  soon: "SOON",
  quiet: "QUIET",
};

const CATEGORY_ORDER: DeskAttentionCategory[] = [
  "needs_attention",
  "happening_now",
  "soon",
  "quiet",
];

type OverviewResponse = {
  ok?: boolean;
  overview?: DeskOverviewSnapshot;
};

export function DeskOverviewPanel() {
  const { getAuthHeaders } = useDeskGate();
  const [overview, setOverview] = useState<DeskOverviewSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(false);
    const headers = await getAuthHeaders();
    if (!headers) {
      setOverview(null);
      setError(true);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/desk/overview", {
        headers,
        cache: "no-store",
      });
      if (!response.ok) {
        setOverview(null);
        setError(true);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as OverviewResponse;
      setOverview(data.overview ?? null);
      setLoading(false);
    } catch {
      setOverview(null);
      setError(true);
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const interval = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [load]);

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: (overview?.signals ?? []).filter((s) => s.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="desk-overview" aria-label="What needs my attention">
      <div className="desk-overview__header">
        <h2 className="desk-section-title">WHAT NEEDS MY ATTENTION?</h2>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </div>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {loading && !overview ? <p className="muted">…</p> : null}
      {error && !overview ? (
        <p className="muted">The overview could not be opened.</p>
      ) : null}

      {grouped.map((group) => (
        <div key={group.category} className="desk-overview__group">
          <h3 className="desk-overview__group-title">
            {CATEGORY_LABEL[group.category]}
          </h3>
          <ul className="desk-overview__list">
            {group.items.map((signal: DeskAttentionSignal) => (
              <li key={signal.id}>
                {signal.message}
                {signal.availability === "unavailable" ? (
                  <span className="muted"> · unavailable</span>
                ) : null}
                {signal.href ? (
                  <>
                    {" "}
                    <Link href={signal.href} className="btn-text">
                      [ open ]
                    </Link>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {overview && !overview.allSourcesOk ? (
        <p className="muted desk-overview__note">
          Some sources could not be checked.
        </p>
      ) : null}

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>
    </section>
  );
}
