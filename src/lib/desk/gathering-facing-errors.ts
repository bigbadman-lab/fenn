import { GreenwoodError } from "@/lib/greenwood/errors";

/** Keeper-safe Gathering error copy. */
export function deskFacingGatheringError(error: unknown): string {
  if (error instanceof GreenwoodError) {
    switch (error.code) {
      case "greenwood_gathering_overlap":
        return "Another Gathering already holds the Fire during this time.";
      case "greenwood_gathering_not_found":
        return "That Gathering could not be found.";
      case "greenwood_gathering_cancelled":
        return "This Gathering was cancelled.";
      case "greenwood_gathering_closed":
        return "This Gathering has already ended.";
      case "greenwood_gathering_not_active":
        return "This Gathering is not live.";
      case "greenwood_gathering_full":
        return "The circle is full.";
      case "greenwood_membership_required":
        return "Greenwood membership is required.";
      case "greenwood_gathering_failed": {
        const msg = error.message.toLowerCase();
        if (msg.includes("draft")) {
          if (msg.includes("edited") || msg.includes("changed")) {
            return "This Gathering can no longer be changed.";
          }
          if (msg.includes("closed")) {
            return "Draft Gatherings cannot be ended this way.";
          }
          if (msg.includes("publish") || msg.includes("published")) {
            return "Only unfinished calls can be published this way.";
          }
        }
        if (msg.includes("duration")) {
          return "The duration must be between 5 minutes and 12 hours.";
        }
        if (msg.includes("title")) {
          return "Why we are gathering is required.";
        }
        if (msg.includes("summary") || msg.includes("message")) {
          return "What Outlaws should know is required.";
        }
        if (msg.includes("invalid gathering times") || msg.includes("ends_at")) {
          return "The Gathering times could not be set.";
        }
        return "The Gathering could not be called.";
      }
      default:
        return "The Gathering could not be called.";
    }
  }
  if (error instanceof Error && error.message.trim()) {
    // Never leak raw SQL/trigger text as-is for unknown errors.
    return "The Gathering could not be called.";
  }
  return "The Gathering could not be called.";
}
