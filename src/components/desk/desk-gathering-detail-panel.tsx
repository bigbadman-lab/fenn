"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDeskGate } from "@/components/desk/desk-gate";
import type { DeskGatheringDetail } from "@/lib/desk/gatherings-types";

export function DeskGatheringDetailPanel({ gatheringId }: { gatheringId: string }) {
  const { getAuthHeaders } = useDeskGate();
  const [detail, setDetail] = useState<DeskGatheringDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const headers = await getAuthHeaders();
    if (!headers) {
      setError("Could not open Gathering.");
      return;
    }
    const response = await fetch(`/api/desk/gatherings/${gatheringId}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      ok?: boolean;
      gathering?: DeskGatheringDetail;
      error?: string;
    };
    if (!response.ok || !data.gathering) {
      setError(data.error ?? "Gathering not found.");
      setDetail(null);
      return;
    }
    setDetail(data.gathering);
  }, [getAuthHeaders, gatheringId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(path: string, okMessage: string) {
    setBusy(true);
    setError(null);
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
      setConfirmPublish(false);
      setConfirmClose(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!detail && !error) return <p className="muted">…</p>;
  if (error && !detail) {
    return (
      <section>
        <p className="muted">{error}</p>
        <Link href="/desk/gatherings" className="btn-text">
          [ back ]
        </Link>
      </section>
    );
  }
  if (!detail) return null;

  return (
    <section className="desk-gathering-detail" aria-label={detail.title}>
      <p>
        <Link href="/desk/gatherings" className="btn-text">
          [ back to Gatherings ]
        </Link>
        <button type="button" className="btn-text" onClick={() => void load()}>
          [ refresh ]
        </button>
      </p>
      <h2 className="desk-section-title">{detail.title}</h2>
      <p className="muted">{detail.summary}</p>
      {status ? <p>{status}</p> : null}
      {error ? <p className="muted">{error}</p> : null}

      <p className="desk-divider" aria-hidden>
        ────────────────────
      </p>

      <h3 className="desk-overview__group-title">IDENTITY</h3>
      <ul className="desk-member__facts">
        <li>
          State: {detail.resolvedState} ({detail.status})
        </li>
        <li>
          {detail.startsAt} → {detail.endsAt}
        </li>
        <li>Capacity: {detail.capacity ?? "—"}</li>
        <li>LEAF preview: {detail.rewardLeafPreview ?? "—"}</li>
        <li>Deed: {detail.linkedDeed?.title ?? "—"}</li>
      </ul>

      <h3 className="desk-overview__group-title">PARTICIPATION</h3>
      <ul className="desk-member__facts">
        <li>Attendance: {detail.attendanceCount}</li>
        <li>Open hands: {detail.openHandCount}</li>
        <li>Lowered: {detail.loweredHandCount}</li>
        <li>
          Campaign:{" "}
          {detail.rewardCampaign
            ? `${detail.rewardCampaign.title} (${detail.rewardCampaign.status})`
            : "none"}
        </li>
      </ul>

      {detail.status === "draft" ? (
        <div className="desk-gatherings__actions">
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
                {detail.attendanceCount} attendance. Hands still raised when
                the Gathering closes may later be used for a Hollow campaign.
                No reward is created automatically.
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

      {detail.resolvedState === "closed" &&
      !detail.rewardCampaign &&
      detail.openHandCount === 0 ? (
        <p className="muted">
          No final open hands remain for a Hollow campaign.
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
              {hand.sigil ? (
                <pre
                  className="ascii desk-register__sigil"
                  aria-label={hand.sigil.a11yLabel}
                >
                  {hand.sigil.asciiBody}
                </pre>
              ) : null}
              {hand.displayName} · {hand.isOpen ? "raised" : "lowered"} ·{" "}
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
    </section>
  );
}
