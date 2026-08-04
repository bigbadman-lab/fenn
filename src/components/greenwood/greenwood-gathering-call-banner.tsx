"use client";

import { GatheringCallBanner } from "@/components/greenwood/gathering-call-banner";
import type { FireGatheringsSnapshot } from "@/lib/greenwood/gatherings/types";

type Props = {
  snapshot: FireGatheringsSnapshot | null;
};

/**
 * Fire Calling banner — presentational; parent owns the Gathering pulse.
 */
export function GreenwoodGatheringCallBanner({ snapshot }: Props) {
  const focus = snapshot?.active ?? snapshot?.upcoming ?? null;
  if (!focus) return null;
  if (focus.announcementStyle !== "fire_calling") return null;
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
