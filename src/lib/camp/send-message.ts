import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CAMP_HISTORY_MESSAGE_LIMIT } from "@/lib/camp/config";
import type {
  CampMessageRow,
  SafeCampMessage,
  SafeCampReward,
} from "@/lib/camp/dto";
import { toSafeCampMessage, toSafeCampReward } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";
import {
  campRequestHashes,
  isCampClientMessageId,
} from "@/lib/camp/hash";
import {
  findCampMessageByHash,
  loadCampHistoryForModel,
  MESSAGE_SELECT,
} from "@/lib/camp/conversation";
import { resolveConversationalCampCharacter } from "@/lib/camp/resolve-character";
import {
  getOrCreateCampSession,
  refreshCampSessionCounters,
} from "@/lib/camp/sessions";
import { validateCampUserMessage } from "@/lib/camp/history";
import { normalizeCampEvaluation } from "@/lib/camp/normalize-evaluation";
import {
  applyCampMessageReward,
  type ApplyCampMessageRewardResult,
} from "@/lib/camp/reward";
import {
  runCampCharacterTurn,
  type CampModelCaller,
} from "@/lib/camp/runtime";
import {
  detectCampRepetition,
  detectCampRewardGaming,
} from "@/lib/camp/signals";
import type { CampContributionEvaluation } from "@/lib/camp/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type SendCampMessageResult = {
  userMessage: SafeCampMessage;
  assistantMessage: SafeCampMessage;
  reward: SafeCampReward;
  rewardUnavailable: boolean;
  reused: boolean;
};

export type CampRewardApplicator = (input: {
  messageId: string;
  admin: SupabaseClient;
}) => Promise<ApplyCampMessageRewardResult>;

/**
 * Persist user turn + assistant reply with request idempotency, then apply
 * server-controlled Camp LEAF reward (caps/cooldown via RPC).
 * No memory_candidates inserts. Conversation survives reward failures.
 */
export async function sendCampMessage(input: {
  profileId: string;
  outlawNumber: number;
  characterSlug: string;
  message: string;
  clientMessageId: string;
  admin?: SupabaseClient;
  callModel?: CampModelCaller;
  applyReward?: CampRewardApplicator;
}): Promise<SendCampMessageResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const applyReward = input.applyReward ?? defaultApplyReward;

  if (!isCampClientMessageId(input.clientMessageId)) {
    throw new CampAiError(
      "camp_message_invalid",
      "Invalid clientMessageId",
      400,
    );
  }

  const userContent = validateCampUserMessage(input.message);
  const character = await resolveConversationalCampCharacter(
    input.characterSlug,
    admin,
  );
  const session = await getOrCreateCampSession({
    profileId: input.profileId,
    characterId: character.row.id,
    admin,
  });

  const { userHash, assistantHash } = campRequestHashes({
    profileId: input.profileId,
    sessionId: session.id,
    clientMessageId: input.clientMessageId,
  });

  const existingUser = await findCampMessageByHash({
    sessionId: session.id,
    profileId: input.profileId,
    hash: userHash,
    admin,
  });
  const existingAssistant = await findCampMessageByHash({
    sessionId: session.id,
    profileId: input.profileId,
    hash: assistantHash,
    admin,
  });

  if (existingUser && existingAssistant) {
    const userSafe = toSafeCampMessage(existingUser);
    let assistantSafe = toSafeCampMessage(existingAssistant);
    if (!userSafe || !assistantSafe) {
      throw new CampAiError(
        "camp_write_failed",
        "Stored Camp turn is unreadable",
        500,
      );
    }

    // Idempotent replay: ensure reward decision exists without double-grant.
    let rewardUnavailable = false;
    let granted = Number(existingAssistant.reward_granted ?? 0);
    const alreadyFinalized = hasFinalizedRewardPolicy(
      existingAssistant.moderation_flags,
    );
    if (!alreadyFinalized && granted === 0) {
      try {
        const rewardResult = await applyReward({
          messageId: existingAssistant.id,
          admin,
        });
        granted = rewardResult.actualGrant;
        assistantSafe = {
          ...assistantSafe,
          ...(granted > 0 ? { rewardGranted: granted } : {}),
        };
      } catch {
        rewardUnavailable = true;
      }
    }

    return {
      userMessage: userSafe,
      assistantMessage: assistantSafe,
      reward: toSafeCampReward(granted),
      rewardUnavailable,
      reused: true,
    };
  }

  if (existingAssistant && !existingUser) {
    throw new CampAiError(
      "camp_request_conflict",
      "Incomplete Camp turn state",
      409,
    );
  }

  let userRow = existingUser;
  if (!userRow) {
    userRow = await insertUserMessage({
      admin,
      sessionId: session.id,
      profileId: input.profileId,
      characterId: character.row.id,
      content: userContent,
      clientMessageHash: userHash,
    });
    await refreshCampSessionCounters(session.id, admin);
  }

  // Load history including the saved user message; Stage 7.1 bounds to 20.
  const historyIncludingUser = await loadCampHistoryForModel({
    sessionId: session.id,
    profileId: input.profileId,
    limit: CAMP_HISTORY_MESSAGE_LIMIT + 1,
    admin,
  });

  // runCampCharacterTurn appends userMessage again — pass prior turns only.
  const prior = historyIncludingUser.slice(0, -1);

  let turn;
  try {
    turn = await runCampCharacterTurn(
      {
        promptKey: character.config.promptKey,
        outlawNumber: input.outlawNumber,
        conversationHistory: prior,
        userMessage: userContent,
      },
      input.callModel ? { callModel: input.callModel } : undefined,
    );
  } catch (error) {
    if (error instanceof CampAiError) throw error;
    throw new CampAiError(
      "camp_ai_invalid_response",
      "Camp intelligence failed",
      502,
    );
  }

  const priorUserMessages = prior
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  const repetition = detectCampRepetition({
    userMessage: userContent,
    priorUserMessages,
  });
  const rewardGaming = detectCampRewardGaming(userContent);
  const normalized = normalizeCampEvaluation({
    raw: turn.evaluation,
    signals: {
      repeatedContent: repetition.repeatedContent,
      repetitionSimilarity: repetition.similarity,
      rewardGaming,
    },
  });

  let assistantRow = await insertAssistantMessage({
    admin,
    sessionId: session.id,
    profileId: input.profileId,
    characterId: character.row.id,
    content: turn.reply,
    clientMessageHash: assistantHash,
    evaluation: normalized.evaluation,
    promptVersion: turn.promptVersion,
    moderationFlags: {
      promptVersion: turn.promptVersion,
      evaluationReason: normalized.evaluation.reason,
      repeatedContent: normalized.signals.repeatedContent,
      repetitionSimilarity: normalized.signals.repetitionSimilarity,
      rewardGaming: normalized.signals.rewardGaming,
      normalizedByServer: true,
      originalRecommendation: normalized.originalRecommendation,
      finalRecommendation: normalized.finalRecommendation,
      originalMemoryCandidate: normalized.originalMemoryCandidate,
      finalMemoryCandidate: normalized.finalMemoryCandidate,
    },
  });

  await refreshCampSessionCounters(session.id, admin);

  let rewardUnavailable = false;
  let granted = 0;
  try {
    const rewardResult = await applyReward({
      messageId: assistantRow.id,
      admin,
    });
    granted = rewardResult.actualGrant;
    // Refresh row fields for SafeCampMessage mapping when store updated.
    assistantRow = {
      ...assistantRow,
      reward_granted: granted,
      leaf_ledger_id: rewardResult.ledgerId,
    };
  } catch {
    rewardUnavailable = true;
  }

  const userSafe = toSafeCampMessage(userRow);
  const assistantSafe = toSafeCampMessage(assistantRow);
  if (!userSafe || !assistantSafe) {
    throw new CampAiError(
      "camp_write_failed",
      "Persisted Camp turn is unreadable",
      500,
    );
  }

  return {
    userMessage: userSafe,
    assistantMessage: assistantSafe,
    reward: toSafeCampReward(granted),
    rewardUnavailable,
    reused: Boolean(existingUser),
  };
}

async function defaultApplyReward(input: {
  messageId: string;
  admin: SupabaseClient;
}): Promise<ApplyCampMessageRewardResult> {
  return applyCampMessageReward({
    messageId: input.messageId,
    admin: input.admin,
  });
}

function hasFinalizedRewardPolicy(
  flags: Record<string, unknown> | null | undefined,
): boolean {
  if (!flags || typeof flags !== "object") return false;
  const policy = flags.rewardPolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return false;
  }
  return "actual" in (policy as Record<string, unknown>);
}

async function insertUserMessage(input: {
  admin: SupabaseClient;
  sessionId: string;
  profileId: string;
  characterId: string;
  content: string;
  clientMessageHash: string;
}): Promise<CampMessageRow> {
  const { data, error } = await input.admin
    .from("camp_messages")
    .insert({
      session_id: input.sessionId,
      profile_id: input.profileId,
      character_id: input.characterId,
      role: "user",
      content: input.content,
      client_message_hash: input.clientMessageHash,
      reward_granted: 0,
      memory_candidate_flag: false,
      moderation_flags: {},
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error?.code === "23505") {
    const existing = await findCampMessageByHash({
      sessionId: input.sessionId,
      profileId: input.profileId,
      hash: input.clientMessageHash,
      admin: input.admin,
    });
    if (existing) return existing;
  }

  if (error || !data) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to store Camp message",
      500,
    );
  }
  return data as CampMessageRow;
}

async function insertAssistantMessage(input: {
  admin: SupabaseClient;
  sessionId: string;
  profileId: string;
  characterId: string;
  content: string;
  clientMessageHash: string;
  evaluation: CampContributionEvaluation;
  promptVersion: string;
  moderationFlags: Record<string, unknown>;
}): Promise<CampMessageRow> {
  const { data, error } = await input.admin
    .from("camp_messages")
    .insert({
      session_id: input.sessionId,
      profile_id: input.profileId,
      character_id: input.characterId,
      role: "assistant",
      content: input.content,
      client_message_hash: input.clientMessageHash,
      reward_recommendation: input.evaluation.rewardRecommendation,
      reward_granted: 0,
      quality: input.evaluation.quality,
      originality: input.evaluation.originality,
      relevance: input.evaluation.relevance,
      spam_probability: input.evaluation.spamProbability,
      memory_candidate_flag: input.evaluation.memoryCandidate,
      leaf_ledger_id: null,
      moderation_flags: input.moderationFlags,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error?.code === "23505") {
    const existing = await findCampMessageByHash({
      sessionId: input.sessionId,
      profileId: input.profileId,
      hash: input.clientMessageHash,
      admin: input.admin,
    });
    if (existing) return existing;
  }

  if (error || !data) {
    throw new CampAiError(
      "camp_write_failed",
      "Failed to store Camp reply",
      500,
    );
  }
  return data as CampMessageRow;
}
