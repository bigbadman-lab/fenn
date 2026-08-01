"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useFennAuth } from "@/components/auth/fenn-auth-provider";
import type {
  AdminGatheringDetail,
  AdminGatheringListItem,
} from "@/lib/greenwood/gatherings/types";

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminGatheringsBoard() {
  const { privyReady, loading, authenticated, getAuthHeaders, login } =
    useFennAuth();
  const [items, setItems] = useState<AdminGatheringListItem[] | null>(null);
  const [detail, setDetail] = useState<AdminGatheringDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("THE GREENWOOD GATHERS");
  const [summary, setSummary] = useState(
    "Those wishing to be remembered should raise a hand before the Fire.",
  );
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState("");
  const [rewardPreview, setRewardPreview] = useState("25");

  const loadList = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setDenied(true);
      setItems([]);
      return;
    }
    const response = await fetch("/api/admin/greenwood/gatherings", {
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
      gatherings?: AdminGatheringListItem[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "the desk could not be opened.");
      setItems([]);
      return;
    }
    setDenied(false);
    setItems(data.gatherings ?? []);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!privyReady || loading || !authenticated) return;
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [privyReady, loading, authenticated, loadList]);

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch("/api/admin/greenwood/gatherings", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          summary,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          capacity: capacity.trim() ? Number(capacity) : null,
          rewardLeafPreview: rewardPreview.trim()
            ? Number(rewardPreview)
            : null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "create failed");
        return;
      }
      setStatus("draft created.");
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, okMessage: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(path, {
        method: "POST",
        headers,
        cache: "no-store",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "action failed");
        return;
      }
      setStatus(okMessage);
      setDetail(null);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/admin/greenwood/gatherings/${id}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      gathering?: AdminGatheringDetail;
      error?: string;
    };
    if (!response.ok || !data.gathering) {
      setError(data.error ?? "detail failed");
      return;
    }
    setDetail(data.gathering);
    if (data.gathering.status === "draft") {
      setTitle(data.gathering.title);
      setSummary(data.gathering.summary);
      setStartsAt(toLocalInputValue(data.gathering.startsAt));
      setEndsAt(toLocalInputValue(data.gathering.endsAt));
      setCapacity(
        data.gathering.capacity != null ? String(data.gathering.capacity) : "",
      );
      setRewardPreview(
        data.gathering.rewardLeafPreview != null
          ? String(data.gathering.rewardLeafPreview)
          : "",
      );
    }
  }

  async function saveDraft() {
    if (!detail || detail.status !== "draft") return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/admin/greenwood/gatherings/${detail.id}`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            summary,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            capacity: capacity.trim() ? Number(capacity) : null,
            rewardLeafPreview: rewardPreview.trim()
              ? Number(rewardPreview)
              : null,
          }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "update failed");
        return;
      }
      setStatus("draft updated.");
      await loadList();
      await openDetail(detail.id);
    } finally {
      setBusy(false);
    }
  }

  if (!privyReady || loading) {
    return <p className="muted">the desk is waking...</p>;
  }

  if (!authenticated) {
    return (
      <div className="admin-deeds">
        <p>admin sign-in required.</p>
        <button type="button" className="btn-text" onClick={() => login()}>
          [ enter ]
        </button>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="admin-deeds">
        <p>this desk is not for your hand.</p>
      </div>
    );
  }

  return (
    <div className="admin-deeds admin-gatherings">
      <header className="admin-deeds__header">
        <p className="admin-deeds__eyebrow">GREENWOOD · GATHERINGS</p>
        <h1 className="place__title">THE CALL DESK</h1>
        <p className="muted">
          schedule Gatherings at The Fire. Raise Hand only. Hollow campaigns
          are created from closed Gatherings on the rewards desk.
        </p>
        <p>
          <Link href="/admin/greenwood/rewards" className="btn-text">
            [ rewards desk ]
          </Link>
        </p>
      </header>

      {status ? <p className="admin-deeds__status">{status}</p> : null}
      {error ? <p className="deed-proof__error">{error}</p> : null}

      <form className="admin-gatherings__form" onSubmit={createDraft}>
        <h2 className="deed-detail__label">CREATE DRAFT</h2>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">title</span>
          <input
            className="deed-proof-field__control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">summary</span>
          <textarea
            className="deed-proof-field__control"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">starts</span>
          <input
            className="deed-proof-field__control"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">ends</span>
          <input
            className="deed-proof-field__control"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">capacity (optional)</span>
          <input
            className="deed-proof-field__control"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="deed-proof-field">
          <span className="deed-proof-field__label">LEAF preview (optional)</span>
          <input
            className="deed-proof-field__control"
            value={rewardPreview}
            onChange={(e) => setRewardPreview(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <div className="admin-deed-ticket__actions">
          <button type="submit" className="btn-text" disabled={busy}>
            [ create draft ]
          </button>
          {detail?.status === "draft" ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                void saveDraft();
              }}
            >
              [ save draft ]
            </button>
          ) : null}
        </div>
      </form>

      <hr className="greenwood-member__rule" />

      <h2 className="deed-detail__label">GATHERINGS</h2>
      {items == null ? (
        <p className="muted">loading...</p>
      ) : items.length === 0 ? (
        <p className="muted">none yet.</p>
      ) : (
        <ul className="admin-deeds__list">
          {items.map((item) => (
            <li key={item.id} className="admin-deed-ticket">
              <p>
                <strong>{item.title}</strong>
              </p>
              <p className="muted admin-deed-ticket__meta">
                {item.status} · resolved {item.resolvedState} · hands{" "}
                {item.handCount} · attendance {item.attendanceCount}
              </p>
              <p className="muted">
                {toLocalInputValue(item.startsAt)} →{" "}
                {toLocalInputValue(item.endsAt)}
              </p>
              <div className="admin-deed-ticket__actions">
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => {
                    void openDetail(item.id);
                  }}
                >
                  [ inspect ]
                </button>
                {item.status === "draft" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/gatherings/${item.id}/publish`,
                        "published.",
                      );
                    }}
                  >
                    [ publish ]
                  </button>
                ) : null}
                {item.status !== "cancelled" && item.status !== "closed" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/gatherings/${item.id}/cancel`,
                        "cancelled.",
                      );
                    }}
                  >
                    [ cancel ]
                  </button>
                ) : null}
                {item.status === "scheduled" || item.status === "active" ? (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        `/api/admin/greenwood/gatherings/${item.id}/close`,
                        "closed.",
                      );
                    }}
                  >
                    [ close ]
                  </button>
                ) : null}
                {item.resolvedState === "closed" || item.status === "closed" ? (
                  <Link
                    href={`/admin/greenwood/rewards?gathering=${item.id}`}
                    className="btn-text"
                  >
                    [ create reward campaign ]
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <>
          <hr className="greenwood-member__rule" />
          <h2 className="deed-detail__label">HANDS · {detail.title}</h2>
          <p className="muted">
            open hands are reward-relevant at close. attendance is retained when
            lowered.
          </p>
          {detail.hands.length === 0 ? (
            <p className="muted">no hands yet.</p>
          ) : (
            <ul className="admin-deeds__list">
              {detail.hands.map((hand) => (
                <li
                  key={`${hand.outlawLabel}-${hand.raisedAt}`}
                  className="admin-deed-ticket"
                >
                  <p>
                    {hand.displayName}{" "}
                    <span className="muted">
                      {hand.isOpen ? "raised" : "lowered"}
                    </span>
                  </p>
                  <p className="muted">
                    raised {hand.raisedAt}
                    {hand.loweredAt ? ` · lowered ${hand.loweredAt}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
