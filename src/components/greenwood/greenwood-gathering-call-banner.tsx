"use client";

import { GatheringCallBanner } from "@/components/greenwood/gathering-call-banner";
import { announcementStyleShowsGreenwoodBanner } from "@/lib/greenwood/gatherings/announcement-style";
import type { FireGatheringsSnapshot } from "@/lib/greenwood/gatherings/types";

type Props = {
  snapshot: FireGatheringsSnapshot | null;
};

/**
 * Fire Calls / World Call banner — presentational; parent owns the pulse.
 */
export function GreenwoodGatheringCallBanner({ snapshot }: Props) {
  const focus = snapshot?.active ?? snapshot?.upcoming ?? null;
  if (!focus) return null;
  if (!announcementStyleShowsGreenwoodBanner(focus.announcementStyle)) {
    return null;
  }
  if (focus.resolvedState !== "active" && focus.resolvedState !== "scheduled") {
    return null;
  }

  return (
    <GatheringCallBanner
      title={focus.title}
      resolvedState={focus.resolvedState}
      startsAt={focus.startsAt}
      endsAt={focus.endsAt}
      announcementStyle={focus.announcementStyle}
      serverNow={focus.serverNow}
      mode="live"
    />
  );
}
