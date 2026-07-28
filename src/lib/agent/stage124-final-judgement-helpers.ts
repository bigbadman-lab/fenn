import { stage124FinalJudgementModelSchema } from "@/lib/agent/stage124-final-judgement-schema";
import type {
  Stage124FinalJudgementModelOutput,
  Stage124FinalJudgementIntention,
} from "@/lib/agent/stage124-final-judgement-schema";

import {
  normalizeStage124FinalJudgementIntention,
} from "@/lib/agent/stage124-final-judgement-schema";

const FORBIDDEN_AUTHORITY_FIELDS = [
  "sourceType",
  "source_type",
  "sourceExternalId",
  "source_external_id",
  "createdAt",
  "created_at",
  "id",
  "perceptionEventId",
  "perception_event_id",
  "event_id",
  "profileId",
  "profile_id",
  "authority",
  "scope",
  "toolCredentials",
  "apiKey",
  "bearerToken",
  "needsLiveState",
  "live_state_succeeded",
] as const;

export function parseStage124FinalJudgementModelOutput(
  value: unknown,
): Stage124FinalJudgementModelOutput {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    for (const key of FORBIDDEN_AUTHORITY_FIELDS) {
      if (key in obj) {
        throw new Error(`Forbidden final judgement field: ${key}`);
      }
    }
  }

  return stage124FinalJudgementModelSchema.parse(value);
}

export { normalizeStage124FinalJudgementIntention };
export type { Stage124FinalJudgementIntention, Stage124FinalJudgementModelOutput };

