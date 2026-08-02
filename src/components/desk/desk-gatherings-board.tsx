"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type {
  DeskGatheringDetail,
  DeskGatheringFilter,
  DeskGatheringListItem,
} from "@/lib/desk/gatherings-types";

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationLabel(startsAt: string, endsAt: string): string {
  const ms = Date.parse(endsAt) - Date.parse(startsAt);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function DeskGatheringsBoard() {
  const { getAuthHeaders } = useDeskGate();
  const [filter, setFilter] = useState<DeskGatheringFilter>("all");
  const [items, setItems] = useState<DeskGatheringListItem[] | null>(null);
  const [detail, setDetail] = useState<DeskGatheringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

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
      setItems([]);
      setError("The Gatherings could not be opened.");
      return;
    }
    const response = await fetch(
      `/api/desk/gatherings?filter=${encodeURIComponent(filter)}`,
      { headers, cache: "no-store" },
    );
    const data = (await response.json()) as {
      ok?: boolean;
      gatherings?: DeskGatheringListItem[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      setError(data.error ?? "The Gatherings could not be opened.");
      setItems([]);
      return;
    }
    setItems(data.gatherings ?? []);
  }, [getAuthHeaders, filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadList();
    }, 45_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [loadList]);

  async function openDetail(id: string) {
    setError(null);
    setConfirmPublish(false);
    setConfirmClose(false);
    setConfirmCancel(false);
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/desk/gatherings/${id}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      gathering?: DeskGatheringDetail;
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

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch("/api/desk/gatherings", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
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

  async function saveDraft() {
    if (!detail || detail.status !== "draft") return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/desk/gatherings/${detail.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
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
        setError(data.error ?? "save failed");
        return;
      }
      setStatus("draft saved.");
      await openDetail(detail.id);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function act(
    path: string,
    okMessage: string,
    body?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(path, {
        method: "POST",
        headers: body
          ? { ...headers, "Content-Type": "application/json" }
          : headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "action failed");
        return;
      }
      setStatus(okMessage);
      setDetail(null);
      setConfirmPublish(false);
      setConfirmClose(false);
      setConfirmCancel(false);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="desk-gatherings" aria-label="Gatherings">
      <div className="desk-overview__header">
        <h2 className="desk-section-title">GATHERINGS</h2>
        <button
          type="button"
          className="btn-text"
          onClick={() => void loadList()}
        >
          [ refresh ]
        </button>
      </div>
      <p className="muted">WHAT IS HAPPENING AT THE FIRE?</p>

      <label className="desk-register__field">
        <span className="muted">Filter</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as DeskGatheringFilter)}
        >
          <option value="all">all</option>
          <option value="draft">draft</option>
          <option value="upcoming">upcoming</option>
          <option value="active">active</option>
          <option value="closed">closed</option>
          <option value="cancelled">cancelled</option>
          <option value="closed_hands_no_campaign">
            closed · hands · no campaign
          </option>
        </select>
      </label>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      {error ? <p className="muted">{error}</p> : null}
      {status ? <p className="desk-overview__note">{status}</p> : null}

      <h3 className="desk-overview__group-title">CREATE DRAFT</h3>
      <form className="desk-gatherings__form" onSubmit={createDraft}>
        <label className="desk-register__field">
          <span className="muted">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="desk-register__field">
          <span className="muted">Summary</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label className="desk-register__field">
          <span className="muted">Starts</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="desk-register__field">
          <span className="muted">Ends</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
        <label className="desk-register__field">
          <span className="muted">Capacity</span>
          <input value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        <label className="desk-register__field">
          <span className="muted">LEAF preview</span>
          <input
            value={rewardPreview}
            onChange={(e) => setRewardPreview(e.target.value)}
          />
        </label>
        <p className="muted">Location: Fire · Interaction: Raise Hand</p>
        <button type="submit" className="btn-text" disabled={busy}>
          [ create draft ]
        </button>
      </form>

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      <h3 className="desk-overview__group-title">LIST</h3>
      {items == null ? <p className="muted">…</p> : null}
      {items && items.length === 0 ? (
        <p className="muted">No Gatherings match.</p>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="desk-member__list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="btn-text"
                onClick={() => void openDetail(item.id)}
              >
                {item.title}
              </button>{" "}
              · {item.resolvedState} · {item.handCount} hands ·{" "}
              {item.attendanceCount} attendance
              {item.rewardCampaign ? " · campaign" : ""}
              {" · "}
              <Link
                href={`/desk/gatherings/${item.id}`}
                className="btn-text"
              >
                [ detail ]
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {detail ? (
        <>
          <p className="desk-divider" aria-hidden>
            ────────────────────
          </p>
          <h3 className="desk-overview__group-title">DETAIL</h3>
          <ul className="desk-member__facts">
            <li>{detail.title}</li>
            <li className="muted">{detail.summary}</li>
            <li>
              State: {detail.resolvedState} ({detail.status})
            </li>
            <li>
              Window: {detail.startsAt.slice(0, 16)} → {detail.endsAt.slice(0, 16)}{" "}
              · {durationLabel(detail.startsAt, detail.endsAt)}
            </li>
            <li>Capacity: {detail.capacity ?? "—"}</li>
            <li>LEAF preview: {detail.rewardLeafPreview ?? "—"}</li>
            <li>
              Deed: {detail.linkedDeed?.title ?? detail.linkedDeedId ?? "—"}
            </li>
            <li>
              Attendance {detail.attendanceCount} · open hands{" "}
              {detail.openHandCount} · lowered {detail.loweredHandCount}
            </li>
            <li>
              Campaign:{" "}
              {detail.rewardCampaign
                ? `${detail.rewardCampaign.title} (${detail.rewardCampaign.status})`
                : "none"}
            </li>
          </ul>

          {detail.status === "draft" ? (
            <div className="desk-gatherings__actions">
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                [ save draft ]
              </button>
              {!confirmPublish ? (
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => setConfirmPublish(true)}
                >
                  [ prepare publish ]
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>PUBLISH THIS GATHERING</p>
                  <p className="muted">
                    {detail.title} · {durationLabel(detail.startsAt, detail.endsAt)}{" "}
                    · capacity {detail.capacity ?? "—"} · LEAF{" "}
                    {detail.rewardLeafPreview ?? "—"}
                  </p>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/api/desk/gatherings/${detail.id}/publish`,
                        "published.",
                      )
                    }
                  >
                    [ confirm publish ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setConfirmPublish(false)}
                  >
                    [ cancel ]
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {detail.resolvedState === "active" ||
          detail.resolvedState === "scheduled" ? (
            <div className="desk-gatherings__actions">
              {!confirmClose ? (
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => setConfirmClose(true)}
                >
                  [ prepare close ]
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>CLOSE THIS GATHERING</p>
                  <p className="muted">
                    {detail.title} · {detail.openHandCount} hands raised ·{" "}
                    {detail.attendanceCount} attendance.
                  </p>
                  <p className="muted">
                    Hands still raised when the Gathering closes may later be
                    used for a Hollow campaign. No reward is created
                    automatically.
                  </p>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/api/desk/gatherings/${detail.id}/close`,
                        "closed.",
                      )
                    }
                  >
                    [ confirm close ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setConfirmClose(false)}
                  >
                    [ cancel ]
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {detail.resolvedState !== "cancelled" &&
          detail.resolvedState !== "closed" ? (
            <div className="desk-gatherings__actions">
              {!confirmCancel ? (
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                >
                  [ prepare cancel ]
                </button>
              ) : (
                <div className="desk-gatherings__confirm">
                  <p>CANCEL THIS GATHERING</p>
                  <p className="muted">
                    {detail.title} · state {detail.resolvedState} ·{" "}
                    {detail.openHandCount} hands · campaign{" "}
                    {detail.rewardCampaign ? detail.rewardCampaign.status : "none"}
                  </p>
                  <label className="desk-register__field">
                    <span className="muted">Reason</span>
                    <input
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/api/desk/gatherings/${detail.id}/cancel`,
                        "cancelled.",
                        { reason: cancelReason || null },
                      )
                    }
                  >
                    [ confirm cancel ]
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => setConfirmCancel(false)}
                  >
                    [ back ]
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {detail.resolvedState === "closed" &&
          !detail.rewardCampaign &&
          detail.openHandCount > 0 ? (
            <p>
              <Link
                href={`/desk/hollow?gathering=${detail.id}`}
                className="btn-text"
              >
                [ CREATE HOLLOW CAMPAIGN ]
              </Link>
            </p>
          ) : null}

          {detail.rewardCampaign ? (
            <p>
              Campaign: {detail.rewardCampaign.title} (
              {detail.rewardCampaign.status}) ·{" "}
              <Link
                href={`/desk/hollow/${detail.rewardCampaign.id}`}
                className="btn-text"
              >
                [ open in The Hollow ]
              </Link>
            </p>
          ) : null}

          <h3 className="desk-overview__group-title">HANDS</h3>
          {detail.hands.length === 0 ? (
            <p className="muted">No hands recorded.</p>
          ) : (
            <ul className="desk-member__list">
              {detail.hands.map((hand) => (
                <li key={`${hand.profileId}-${hand.raisedAt}`}>
                  {hand.displayName} · #{hand.outlawNumberLabel} ·{" "}
                  {hand.isOpen ? "raised" : "lowered"}
                  {hand.attended ? " · attended" : ""} ·{" "}
                  <Link
                    href={`/desk/register/${hand.profileId}`}
                    className="btn-text"
                  >
                    [ register ]
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
