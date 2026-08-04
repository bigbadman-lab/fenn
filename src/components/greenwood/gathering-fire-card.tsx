"use client";

import Link from "next/link";

import {
  DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
  type GatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
import { formatGatheringCountdown } from "@/lib/greenwood/gatherings/countdown";
import type {
  GatheringResolvedState,
  SafeGathering,
  SafeGatheringDeedLink,
} from "@/lib/greenwood/gatherings/types";

export type GatheringFireCardMode = "live" | "preview";

export type GatheringFireCardModel = {
  title: string;
  summary: string;
  resolvedState: GatheringResolvedState | "preview";
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  rewardLeafPreview: number | null;
  announcementStyle: GatheringAnnouncementStyle;
  handCount: number;
  memberHasRaisedHand?: boolean;
  canRaiseHand?: boolean;
  canLowerHand?: boolean;
  linkedDeed?: SafeGatheringDeedLink | null;
  /** Preview-only duration line when timestamps are not fixed yet. */
  durationMinutes?: number | null;
  serverNow?: string | null;
};

export function gatheringModelFromSafe(
  g: SafeGathering,
): GatheringFireCardModel {
  return {
    title: g.title,
    summary: g.summary,
    resolvedState: g.resolvedState,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    capacity: g.capacity,
    rewardLeafPreview: g.rewardLeafPreview,
    announcementStyle: g.announcementStyle,
    handCount: g.handCount,
    memberHasRaisedHand: g.memberHasRaisedHand,
    canRaiseHand: g.canRaiseHand,
    canLowerHand: g.canLowerHand,
    linkedDeed: g.linkedDeed,
    serverNow: g.serverNow,
  };
}

type GatheringFireCardProps = {
  gathering: GatheringFireCardModel;
  mode?: GatheringFireCardMode;
  /** Controlled countdown label for live member UI; when omitted auto-derives. */
  countdownLabel?: string | null;
  /** When false, hide raise/lower (preview / Desk). */
  showActions?: boolean;
  actionPending?: boolean;
  onRaise?: () => void;
  onLower?: () => void;
  sectionId?: string;
};

function defaultCountdown(
  gathering: GatheringFireCardModel,
  nowMs: number,
): string | null {
  if (gathering.resolvedState === "preview") return null;
  const isActive = gathering.resolvedState === "active";
  const isUpcoming = gathering.resolvedState === "scheduled";
  const target = isActive
    ? gathering.endsAt
    : isUpcoming
      ? gathering.startsAt
      : null;
  if (!target) return null;
  return formatGatheringCountdown(target, nowMs).label;
}

/**
 * Shared Fire Gathering card — member live surface and Desk preview.
 * Presentational only; no data fetching.
 */
export function GatheringFireCard({
  gathering,
  mode = "live",
  countdownLabel,
  showActions = true,
  actionPending = false,
  onRaise,
  onLower,
  sectionId = "gf-gathering",
}: GatheringFireCardProps) {
  const isPreview = mode === "preview" || gathering.resolvedState === "preview";
  const isActive = gathering.resolvedState === "active";
  const isUpcoming = gathering.resolvedState === "scheduled";
  const nowMs = gathering.serverNow
    ? Date.parse(gathering.serverNow)
    : Date.now();
  const label =
    countdownLabel !== undefined
      ? countdownLabel
      : defaultCountdown(gathering, Number.isFinite(nowMs) ? nowMs : Date.now());

  return (
    <section
      className="greenwood-interior__section greenwood-fire-gathering"
      aria-labelledby={`${sectionId}-title`}
      id={sectionId}
    >
      <h2
        id={`${sectionId}-title`}
        className="greenwood-member__section-title greenwood-member__section-title--gathering"
      >
        {isActive || (isPreview && !isUpcoming)
          ? "THE GREENWOOD GATHERS"
          : "NEXT GATHERING"}
      </h2>

      <p className="greenwood-fire-gathering__state" aria-hidden={isPreview}>
        {isPreview
          ? "PREVIEW"
          : isActive
            ? "NOW"
            : isUpcoming
              ? "UPCOMING"
              : "—"}
      </p>

      <p className="muted">
        {isPreview
          ? "Greenwood members will see this at the Fire."
          : isActive
            ? "Those seated at the Fire are here."
            : "Those already seated at the Fire will be present when the Gathering begins."}
      </p>

      <p className="greenwood-fire-gathering__title">
        {gathering.title.trim() || "Untitled Gathering"}
      </p>
      {gathering.summary.trim() ? <p>{gathering.summary}</p> : null}

      {isPreview ? (
        <p className="greenwood-fire-gathering__countdown muted">
          Begins when you press Begin Gathering
          {gathering.durationMinutes != null && gathering.durationMinutes > 0
            ? ` · Lasts for ${gathering.durationMinutes} minutes`
            : ""}
        </p>
      ) : label ? (
        <p className="greenwood-fire-gathering__countdown muted">
          {isActive
            ? `${formatRemainPhrase(label)} remain`
            : `Begins in ${label}`}
        </p>
      ) : null}

      {isActive && !isPreview ? (
        <p className="greenwood-fire-gathering__hands">
          {gathering.handCount} HAND{gathering.handCount === 1 ? "" : "S"} RAISED
        </p>
      ) : null}

      {gathering.capacity != null ? (
        <p className="muted">
          First {gathering.capacity} may raise a hand
        </p>
      ) : null}

      {gathering.rewardLeafPreview != null ? (
        <p className="muted">
          remembrance may later bring {gathering.rewardLeafPreview} LEAF · not
          automatic
        </p>
      ) : null}

      {gathering.linkedDeed ? (
        <p className="greenwood-fire-gathering__deed">
          A DEED IS TIED TO THIS GATHERING
          {gathering.linkedDeed.slug ? (
            <>
              {" "}
              <Link href={`/deeds/${gathering.linkedDeed.slug}`}>
                [ {gathering.linkedDeed.title} ]
              </Link>
            </>
          ) : (
            <> — {gathering.linkedDeed.title}</>
          )}
        </p>
      ) : null}

      {showActions && !isPreview && isActive ? (
        <GatheringHandActions
          memberHasRaisedHand={Boolean(gathering.memberHasRaisedHand)}
          canRaiseHand={Boolean(gathering.canRaiseHand)}
          canLowerHand={Boolean(gathering.canLowerHand)}
          capacity={gathering.capacity}
          pending={actionPending}
          onRaise={onRaise}
          onLower={onLower}
        />
      ) : null}
    </section>
  );
}

function formatRemainPhrase(countdown: string): string {
  // Prefer human copy when format is HH:MM:SS
  const parts = countdown.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const totalMin = h * 60 + m;
      if (totalMin <= 0) return "moments";
      if (totalMin < 60) {
        return totalMin === 1 ? "1 minute" : `${totalMin} minutes`;
      }
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      if (mins === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
      return `${hours}h ${mins}m`;
    }
  }
  return countdown;
}

function GatheringHandActions({
  memberHasRaisedHand,
  canRaiseHand,
  canLowerHand,
  capacity,
  pending,
  onRaise,
  onLower,
}: {
  memberHasRaisedHand: boolean;
  canRaiseHand: boolean;
  canLowerHand: boolean;
  capacity: number | null;
  pending: boolean;
  onRaise?: () => void;
  onLower?: () => void;
}) {
  if (memberHasRaisedHand) {
    return (
      <div className="greenwood-fire-gathering__actions">
        <p className="greenwood-fire-gathering__self-state">
          YOUR HAND IS RAISED
        </p>
        <button
          type="button"
          className="greenwood-fire-gathering__btn"
          disabled={pending || !canLowerHand}
          onClick={onLower}
        >
          {pending ? "[ LOWERING… ]" : "[ LOWER HAND ]"}
        </button>
      </div>
    );
  }

  return (
    <div className="greenwood-fire-gathering__actions">
      <button
        type="button"
        className="greenwood-fire-gathering__btn"
        disabled={pending || !canRaiseHand}
        onClick={onRaise}
      >
        {pending ? "[ RAISING… ]" : "[ RAISE HAND ]"}
      </button>
      {!canRaiseHand && capacity != null ? (
        <p className="muted">the circle is full.</p>
      ) : null}
    </div>
  );
}

export function emptyPreviewModel(partial: {
  title: string;
  summary: string;
  durationMinutes: number;
  capacity: number | null;
  rewardLeafPreview: number | null;
  announcementStyle?: GatheringAnnouncementStyle;
}): GatheringFireCardModel {
  return {
    title: partial.title,
    summary: partial.summary,
    resolvedState: "preview",
    startsAt: null,
    endsAt: null,
    capacity: partial.capacity,
    rewardLeafPreview: partial.rewardLeafPreview,
    announcementStyle:
      partial.announcementStyle ?? DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
    handCount: 0,
    durationMinutes: partial.durationMinutes,
  };
}

/** Stable id for Fire scroll anchors. */
export const GATHERING_FIRE_SECTION_ID = "gf-gathering";
