"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  DeskGatheringDetail,
  DeskGatheringHand,
  DeskGatheringListItem,
} from "@/lib/desk/gatherings-types";
import {
  gatheringAnnouncementStyleLabel,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  durationMinutesBetween,
  formatBeginsInLabel,
  formatDurationMinutesLabel,
  formatRemainingDurationLabel,
} from "@/lib/greenwood/gatherings/duration";

type Gatherable = DeskGatheringListItem | DeskGatheringDetail;

function isDetail(
  g: Gatherable,
): g is DeskGatheringDetail {
  return "hands" in g && Array.isArray((g as DeskGatheringDetail).hands);
}

export type DeskGatheringOperateProps = {
  gathering: Gatherable;
  getAuthHeaders: () => Promise<HeadersInit | null>;
  onChanged: () => void | Promise<void>;
  showBackLink?: boolean;
  /** When compact list mode — no hands until expand? Always show when detail. */
  compact?: boolean;
};

/**
 * Shared operate surface for live / upcoming / after the Fire.
 */
export function DeskGatheringOperate({
  gathering,
  getAuthHeaders,
  onChanged,
  showBackLink = false,
  compact = false,
}: DeskGatheringOperateProps) {
  const [detail, setDetail] = useState<DeskGatheringDetail | null>(
    isDetail(gathering) ? gathering : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showHands, setShowHands] = useState(!compact);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isDetail(gathering)) setDetail(gathering);
  }, [gathering]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const view = detail ?? gathering;
  const openHands = detail?.openHandCount ?? view.handCount;
  const attendance = view.attendanceCount;
  const nowMs = Date.now();
  void tick;

  const remainMs = Math.max(0, Date.parse(view.endsAt) - nowMs);
  const untilStartMs = Math.max(0, Date.parse(view.startsAt) - nowMs);
  const durationMins = durationMinutesBetween(view.startsAt, view.endsAt);
  const resolved = view.resolvedState;
  const hardClosed = view.status === "closed" || view.closedAt != null;
  const cancelled = resolved === "cancelled";
  const timeEnded = resolved === "closed" && !hardClosed && !cancelled;
  const live = resolved === "active";
  const upcoming = resolved === "scheduled";
  const after =
    resolved === "closed" || resolved === "cancelled" || timeEnded;

  async function loadDetail() {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/desk/gatherings/${view.id}`, {
      headers,
      cache: "no-store",
    });
    const data = (await response.json()) as {
      gathering?: DeskGatheringDetail;
      error?: string;
    };
    if (response.ok && data.gathering) {
      setDetail(data.gathering);
      setShowHands(true);
    } else if (data.error) {
      setError(data.error);
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
      if (!headers) {
        setError("Keeper access is required.");
        return;
      }
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
        setError(data.error ?? "The action could not be completed.");
        return;
      }
      setStatus(okMessage);
      setConfirmEnd(false);
      setConfirmCancel(false);
      await loadDetail();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const heading = cancelled
    ? "CANCELLED"
    : timeEnded
      ? "THE FIRE HAS GONE QUIET"
      : hardClosed
        ? "AFTER THE FIRE"
        : live
          ? "THE FIRE IS BURNING"
          : upcoming
            ? "THE FIRE IS WAITING"
            : "GATHERING";

  const hands: DeskGatheringHand[] = detail?.hands ?? [];
  const hollowReady =
    (hardClosed || timeEnded) &&
    !view.rewardCampaign &&
    openHands > 0 &&
    !cancelled;

  return (
    <section className="desk-gathering-operate" aria-label={view.title}>
      {showBackLink ? (
        <p>
          <Link href="/desk/gatherings" className="btn-text">
            [ back to Gatherings ]
          </Link>
        </p>
      ) : null}

      <h2 className="desk-section-title">{heading}</h2>
      <p className="desk-gathering-operate__title">{view.title}</p>
      {view.summary ? <p className="muted">{view.summary}</p> : null}

      {error ? (
        <p className="desk-gathering-call__error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? <p className="desk-overview__note">{status}</p> : null}

      <ul className="desk-member__facts">
        {live ? (
          <li>
            Time remaining · {formatRemainingDurationLabel(remainMs)}
          </li>
        ) : null}
        {upcoming ? (
          <li>
            Begins in · {formatBeginsInLabel(untilStartMs)}
          </li>
        ) : null}
        {(timeEnded || hardClosed) && !cancelled ? (
          <li>
            Ended · {new Date(view.endsAt).toLocaleString()}
          </li>
        ) : null}
        {cancelled && view.cancelledAt ? (
          <li>
            Cancelled · {new Date(view.cancelledAt).toLocaleString()}
          </li>
        ) : null}
        {durationMins != null ? (
          <li>Duration · {formatDurationMinutesLabel(durationMins)}</li>
        ) : null}
        <li>
          Hands raised · {openHands}
          {view.capacity != null ? ` / ${view.capacity}` : ""}
        </li>
        <li>Attendance · {attendance}</li>
        <li>
          Call · {gatheringAnnouncementStyleLabel(view.announcementStyle)}
        </li>
        {view.rewardLeafPreview != null ? (
          <li>
            Hollow preview · {view.rewardLeafPreview} LEAF (not automatic)
          </li>
        ) : null}
        {view.rewardCampaign ? (
          <li>
            Campaign · {view.rewardCampaign.title} ({view.rewardCampaign.status})
          </li>
        ) : null}
      </ul>

      <div className="desk-gatherings__actions">
        <button
          type="button"
          className="btn-text"
          disabled={busy}
          onClick={() => {
            if (!detail) void loadDetail();
            else setShowHands((v) => !v);
          }}
        >
          [ {showHands && detail ? "hide hands" : "view hands"} ]
        </button>
        <Link href={`/desk/gatherings/${view.id}`} className="btn-text">
          [ open detail ]
        </Link>
      </div>

      {(live || upcoming) && !cancelled ? (
        <div className="desk-gatherings__actions">
          {!confirmEnd ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                setConfirmEnd(true);
                setConfirmCancel(false);
              }}
            >
              [ END GATHERING ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>End this Gathering now?</p>
              <p className="muted">
                Members will no longer be able to raise their hands. Hands still
                raised may later be used for a Hollow campaign. No reward is
                created automatically.
              </p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/desk/gatherings/${view.id}/close`,
                    "Gathering ended.",
                  )
                }
              >
                [ confirm end ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmEnd(false)}
              >
                [ back ]
              </button>
            </div>
          )}
        </div>
      ) : null}

      {timeEnded && !hardClosed && !cancelled ? (
        <div className="desk-gatherings__actions">
          <p className="muted">
            Time has passed. Close the record when you are finished.
          </p>
          {!confirmEnd ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => setConfirmEnd(true)}
            >
              [ CLOSE THE RECORD ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>Close the Gathering record?</p>
              <p className="muted">
                {openHands} hands still raised · {attendance} attendance.
                Hollow may use open hands after close. No reward is automatic.
              </p>
              <button
                type="button"
                className="btn-text"
                disabled={busy}
                onClick={() =>
                  void act(
                    `/api/desk/gatherings/${view.id}/close`,
                    "Record closed.",
                  )
                }
              >
                [ confirm close ]
              </button>
              <button
                type="button"
                className="btn-text"
                onClick={() => setConfirmEnd(false)}
              >
                [ back ]
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!cancelled && !hardClosed ? (
        <div className="desk-gatherings__actions">
          {!confirmCancel ? (
            <button
              type="button"
              className="btn-text"
              disabled={busy}
              onClick={() => {
                setConfirmCancel(true);
                setConfirmEnd(false);
              }}
            >
              [ CANCEL GATHERING ]
            </button>
          ) : (
            <div className="desk-gatherings__confirm">
              <p>Cancel this Gathering?</p>
              <p className="muted">
                Cancel means it should not proceed or was abandoned. End means it
                took place and is finished.
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
                    `/api/desk/gatherings/${view.id}/cancel`,
                    "Gathering cancelled.",
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

      {hollowReady ? (
        <p>
          <Link
            href={`/desk/hollow?gathering=${view.id}`}
            className="btn-text"
          >
            [ CREATE HOLLOW CAMPAIGN ]
          </Link>
        </p>
      ) : null}

      {view.rewardCampaign ? (
        <p>
          <Link
            href={`/desk/hollow/${view.rewardCampaign.id}`}
            className="btn-text"
          >
            [ open in The Hollow ]
          </Link>
        </p>
      ) : null}

      {after && hardClosed && !view.rewardCampaign && openHands === 0 ? (
        <p className="muted">
          No final open hands remain for a Hollow campaign.
        </p>
      ) : null}

      {showHands && detail ? (
        <>
          <h3 className="desk-overview__group-title">HANDS</h3>
          {hands.length === 0 ? (
            <p className="muted">No hands recorded.</p>
          ) : (
            <ul className="desk-member__list">
              {hands.map((hand) => (
                <li key={`${hand.profileId}-${hand.raisedAt}`}>
                  {hand.sigil ? (
                    <pre
                      className="ascii desk-register__sigil"
                      aria-label={hand.sigil.a11yLabel}
                    >
                      {hand.sigil.asciiBody}
                    </pre>
                  ) : null}
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
