"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import { formatDeedBoardDate } from "@/lib/deeds/format";
import type { DeedReward } from "@/lib/deeds/types";

type QueueItem = {
  submissionId: string;
  deedId: string;
  deedTitle: string;
  deedSlug: string | null;
  reward: DeedReward;
  rewardLabel: string;
  outlawLabel: string;
  submittedAt: string;
  evidenceText: string | null;
  evidenceUrl: string | null;
  evidenceOther: string | null;
  hasImageEvidence: boolean;
};

export function AdminDeedsBoard() {
  const { privyReady, loading, authenticated, getAuthHeaders, login } =
    useFennAuth();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [rangeAmounts, setRangeAmounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setDenied(true);
      setItems([]);
      return;
    }
    const response = await fetch("/api/admin/deeds/submissions", {
      headers,
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      setDenied(true);
      setItems([]);
      return;
    }
    const data = (await response.json()) as {
      ok?: boolean;
      submissions?: QueueItem[];
    };
    if (!response.ok) {
      setError("the desk could not be opened.");
      setItems([]);
      return;
    }
    setDenied(false);
    setItems(data.submissions ?? []);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !authenticated) return;
    const timer = window.setTimeout(() => {
      void loadQueue();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privyReady, loading, authenticated, loadQueue]);

  async function viewImage(submissionId: string) {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(
      `/api/admin/deeds/submissions/${submissionId}/image`,
      { headers, cache: "no-store" },
    );
    const data = (await response.json()) as { signedUrl?: string };
    if (response.ok && data.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } else {
      setError("image could not be opened.");
    }
  }

  async function onApprove(item: QueueItem) {
    setBusyId(item.submissionId);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;

      let leafAmount: number | null | undefined;
      if (item.reward.type === "range") {
        const raw = rangeAmounts[item.submissionId] ?? "";
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed)) {
          setError("enter an integer LEAF amount.");
          return;
        }
        leafAmount = parsed;
      }

      const response = await fetch(
        `/api/admin/deeds/submissions/${item.submissionId}/approve`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            leafAmount: leafAmount ?? null,
            reviewNote: null,
          }),
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        result?: { leafAwarded: number };
        code?: string;
      };
      if (!response.ok) {
        setError(data.code ?? "approval failed.");
        return;
      }
      const awarded = data.result?.leafAwarded ?? 0;
      setStatus(
        awarded > 0
          ? `APPROVED. ${awarded} LEAF entered in the ledger.`
          : "APPROVED. no LEAF.",
      );
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(event: FormEvent, item: QueueItem) {
    event.preventDefault();
    setBusyId(item.submissionId);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const note = (rejectNotes[item.submissionId] ?? "").trim();
      if (!note) {
        setError("a reason is required to reject.");
        return;
      }
      const response = await fetch(
        `/api/admin/deeds/submissions/${item.submissionId}/reject`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ reviewNote: note }),
        },
      );
      if (!response.ok) {
        const data = (await response.json()) as { code?: string };
        setError(data.code ?? "rejection failed.");
        return;
      }
      setStatus("REJECTED. the proof has been returned.");
      setRejectNotes((prev) => ({ ...prev, [item.submissionId]: "" }));
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  if (!privyReady || loading) {
    return <p className="muted">...</p>;
  }

  if (!authenticated) {
    return (
      <div className="admin-deeds">
        <p>ENTRY IS REQUIRED.</p>
        <button type="button" className="btn-text" onClick={() => login()}>
          [ enter ]
        </button>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="admin-deeds">
        <p>NOTHING FOR YOU HERE.</p>
      </div>
    );
  }

  return (
    <div className="admin-deeds">
      <header className="admin-deeds__header">
        <p className="admin-deeds__eyebrow">THE DESK</p>
        <p className="muted">proof waiting for judgement.</p>
      </header>

      {status ? <p className="admin-deeds__status">{status}</p> : null}
      {error ? <p className="deed-proof__error">{error}</p> : null}

      {items == null ? <p className="muted">...</p> : null}

      {items && items.length === 0 ? (
        <p className="muted">the desk is clear.</p>
      ) : null}

      <ul className="admin-deeds__list">
        {(items ?? []).map((item) => (
          <li key={item.submissionId} className="admin-deed-ticket">
            <p className="admin-deed-ticket__meta">
              {item.outlawLabel}
              <br />
              DEED · {item.deedTitle}
              <br />
              {formatDeedBoardDate(item.submittedAt) ?? "—"}
            </p>

            {item.evidenceText ? (
              <div className="admin-deed-ticket__block">
                <p className="deed-detail__label">PROOF / TEXT</p>
                <p className="admin-deed-ticket__body">{item.evidenceText}</p>
              </div>
            ) : null}

            {item.evidenceUrl ? (
              <div className="admin-deed-ticket__block">
                <p className="deed-detail__label">PROOF / URL</p>
                <p>
                  <a
                    href={item.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    [ open evidence ]
                  </a>
                </p>
              </div>
            ) : null}

            {item.evidenceOther ? (
              <div className="admin-deed-ticket__block">
                <p className="deed-detail__label">PROOF / OTHER</p>
                <p className="admin-deed-ticket__body">{item.evidenceOther}</p>
              </div>
            ) : null}

            {item.hasImageEvidence ? (
              <div className="admin-deed-ticket__block">
                <p className="deed-detail__label">PROOF / IMAGE</p>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => void viewImage(item.submissionId)}
                >
                  [ view image ]
                </button>
              </div>
            ) : null}

            <div className="admin-deed-ticket__block">
              <p className="deed-detail__label">REWARD</p>
              <p>{item.rewardLabel}</p>
              {item.reward.type === "range" ? (
                <label className="deed-proof-field">
                  <span className="deed-proof-field__label">
                    AMOUNT / {item.reward.min}—{item.reward.max}
                  </span>
                  <input
                    className="deed-proof-field__control"
                    type="number"
                    min={item.reward.min}
                    max={item.reward.max}
                    step={1}
                    value={rangeAmounts[item.submissionId] ?? ""}
                    onChange={(e) =>
                      setRangeAmounts((prev) => ({
                        ...prev,
                        [item.submissionId]: e.target.value,
                      }))
                    }
                    disabled={busyId === item.submissionId}
                  />
                </label>
              ) : null}
            </div>

            <p className="admin-deed-ticket__actions">
              <button
                type="button"
                className="btn-text"
                disabled={busyId === item.submissionId}
                onClick={() => void onApprove(item)}
              >
                [ approve ]
              </button>
            </p>

            <form
              className="admin-deed-ticket__reject"
              onSubmit={(e) => void onReject(e, item)}
            >
              <label className="deed-proof-field">
                <span className="deed-proof-field__label">REASON</span>
                <input
                  className="deed-proof-field__control"
                  value={rejectNotes[item.submissionId] ?? ""}
                  onChange={(e) =>
                    setRejectNotes((prev) => ({
                      ...prev,
                      [item.submissionId]: e.target.value,
                    }))
                  }
                  disabled={busyId === item.submissionId}
                  required
                />
              </label>
              <button
                type="submit"
                className="btn-text"
                disabled={busyId === item.submissionId}
              >
                [ reject proof ]
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
