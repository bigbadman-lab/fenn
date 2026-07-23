import {
  CAMP_HISTORY_MESSAGE_LIMIT,
  CAMP_USER_MESSAGE_MAX_CHARS,
} from "@/lib/camp/config";
import { CampAiError } from "@/lib/camp/errors";
import type { CampHistoryMessage } from "@/lib/camp/types";

export function validateCampUserMessage(raw: string): string {
  if (typeof raw !== "string") {
    throw new CampAiError(
      "camp_message_invalid",
      "Message must be a string",
      400,
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new CampAiError(
      "camp_message_invalid",
      "Message cannot be empty",
      400,
    );
  }
  if (trimmed.length > CAMP_USER_MESSAGE_MAX_CHARS) {
    throw new CampAiError(
      "camp_message_invalid",
      `Message exceeds ${CAMP_USER_MESSAGE_MAX_CHARS} characters`,
      400,
    );
  }
  return trimmed;
}

/**
 * Keep only user/assistant turns and the most recent N messages.
 * Does not include evaluation metadata.
 */
export function boundCampConversationHistory(
  history: CampHistoryMessage[],
  limit: number = CAMP_HISTORY_MESSAGE_LIMIT,
): CampHistoryMessage[] {
  const cleaned: CampHistoryMessage[] = [];
  for (const item of history ?? []) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) {
      continue;
    }
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    cleaned.push({ role: item.role, content });
  }
  if (limit <= 0) return [];
  if (cleaned.length <= limit) return cleaned;
  return cleaned.slice(cleaned.length - limit);
}
