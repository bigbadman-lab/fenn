"use client";

import {
  GatheringCallBanner,
} from "@/components/greenwood/gathering-call-banner";
import {
  emptyPreviewModel,
  GatheringFireCard,
} from "@/components/greenwood/gathering-fire-card";
import {
  gatheringAnnouncementStyleLabel,
  type GatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";

export type DeskGatheringPreviewProps = {
  title: string;
  summary: string;
  durationMinutes: number;
  capacity: number | null;
  rewardLeafPreview: number | null;
  announcementStyle: GatheringAnnouncementStyle;
};

/**
 * Keeper preview — reuses member Fire card + optional call banner.
 * No fetches; driven by form state only.
 */
export function DeskGatheringPreview({
  title,
  summary,
  durationMinutes,
  capacity,
  rewardLeafPreview,
  announcementStyle,
}: DeskGatheringPreviewProps) {
  const model = emptyPreviewModel({
    title,
    summary,
    durationMinutes,
    capacity,
    rewardLeafPreview,
    announcementStyle,
  });

  return (
    <div className="desk-gathering-preview" aria-label="How the Greenwood will see it">
      <h3 className="desk-overview__group-title">HOW THE GREENWOOD WILL SEE IT</h3>
      <ul className="desk-member__facts desk-gathering-preview__facts">
        <li>
          <span className="muted">Audience</span> Greenwood members
        </li>
        <li>
          <span className="muted">Duration</span>{" "}
          {durationMinutes > 0 ? `${durationMinutes} minutes` : "—"}
        </li>
        <li>
          <span className="muted">Capacity</span>{" "}
          {capacity != null ? `First ${capacity}` : "No limit"}
        </li>
        <li>
          <span className="muted">Call</span>{" "}
          {gatheringAnnouncementStyleLabel(announcementStyle)}
        </li>
        {rewardLeafPreview != null ? (
          <li>
            <span className="muted">Hollow preview</span> {rewardLeafPreview} LEAF
            (not automatic)
          </li>
        ) : null}
      </ul>

      {announcementStyle === "fire_calling" ? (
        <div className="desk-gathering-preview__banner">
          <GatheringCallBanner
            resolvedState="active"
            startsAt={new Date().toISOString()}
            endsAt={new Date().toISOString()}
            announcementStyle="fire_calling"
            mode="preview"
            durationMinutes={durationMinutes}
          />
        </div>
      ) : null}

      <div className="desk-gathering-preview__card">
        <GatheringFireCard
          gathering={model}
          mode="preview"
          showActions={false}
          sectionId="desk-gathering-preview-card"
        />
      </div>
    </div>
  );
}
