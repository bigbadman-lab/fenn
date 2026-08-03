import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CAMP_HISTORY_MESSAGE_LIMIT } from "@/lib/camp/config";
import { deriveFirstThirtyCampEligibility } from "@/lib/camp/first-thirty-eligibility";
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
// Memory candidate create+review is loaded dynamically in defaultApplyMemoryCandidate
// so Camp persistence tests can assert create path without coupling compile graphs.
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
  safeRetrieveCampKnowledge,
  type CampKnowledgeRetriever,
} from "@/lib/camp/knowledge";
import type { SafeFirstThirtyProgress } from "@/lib/first-thirty/types";
import { buildFennKnowledgeContext } from "@/lib/memory/context";
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
  /** First Thirty RPC failed; conversation still ok — never invent progress. */
  firstThirtyUnavailable?: boolean;
  reused: boolean;
  firstThirty?: SafeFirstThirtyProgress;
};

export type CampRewardApplicator = (input: {
  messageId: string;
  admin: SupabaseClient;
}) => Promise<ApplyCampMessageRewardResult>;

export type CampFirstThirtyApplicator = (input: {
  messageId: string;
  admin: SupabaseClient;
}) => Promise<{
  progress: SafeFirstThirtyProgress;
  suppressOrdinaryCampReward: boolean;
  lastEvent?: {
    milestone: "camp_first" | "camp_three" | "first_deed";
    newlySatisfied: boolean;
    nominalGrant: number;
    actualGrant: number;
    greenwoodOpen: boolean;
  };
}>;

export type CampMemoryCandidateApplicator = (input: {
  messageId: string;
  admin: SupabaseClient;
}) => Promise<unknown>;

/**
 * Persist user turn + assistant reply with request idempotency, then:
 * 1) Stage 7.4 reward (caps/cooldown via RPC)
 * 2) Stage 7.5 best-effort pending memory_candidate
 *
 * Priority: conversation > economic idempotency > memory candidate.
 * Memory failures never fail the turn.
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
  applyFirstThirty?: CampFirstThirtyApplicator;
  applyMemoryCandidate?: CampMemoryCandidateApplicator;
  /** Test seam — defaults to safeRetrieveCampKnowledge (scope locked to camp). */
  retrieveCampKnowledge?: CampKnowledgeRetriever;
}): Promise<SendCampMessageResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const applyReward = input.applyReward ?? defaultApplyReward;
  const applyFirstThirty = input.applyFirstThirty ?? defaultApplyFirstThirty;
  const applyMemoryCandidate =
    input.applyMemoryCandidate ?? defaultApplyMemoryCandidate;

  if (!isCampClientMessageId(input.clientMessageId)) {
    throw new CampAiError(
      "camp_message_invalid",
      "Invalid clientMessageId",
      400,
    );
  }

  const userContent = validateCampUserMessage(input.message);
  // Fresh character active/locked check on every send — not card-open state.
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

    // Idempotent replay: First Thirty then ordinary reward without double-grant.
    let rewardUnavailable = false;
    let firstThirtyUnavailable = false;
    let granted = Number(existingAssistant.reward_granted ?? 0);
    let firstThirty: SafeFirstThirtyProgress | undefined;
    const alreadyFinalized = hasFinalizedRewardPolicy(
      existingAssistant.moderation_flags,
    );

    let suppressCamp = false;
    try {
      const ft = await applyFirstThirty({
        messageId: existingAssistant.id,
        admin,
      });
      firstThirty = ft.progress;
      suppressCamp = ft.suppressOrdinaryCampReward;
    } catch {
      // First Thirty failure must not block conversation replay.
      firstThirtyUnavailable = true;
    }

    if (!alreadyFinalized && granted === 0 && !suppressCamp) {
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

    // Best-effort memory candidate on replay (unique camp_message_id).
    if (existingAssistant.memory_candidate_flag) {
      try {
        await applyMemoryCandidate({
          messageId: existingAssistant.id,
          admin,
        });
      } catch {
        // Memory is lowest criticality — never fail the turn.
      }
    }

    return {
      userMessage: userSafe,
      assistantMessage: assistantSafe,
      reward: toSafeCampReward(granted),
      rewardUnavailable,
      ...(firstThirtyUnavailable ? { firstThirtyUnavailable: true } : {}),
      reused: true,
      ...(firstThirty ? { firstThirty } : {}),
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
      clientMessageId: input.clientMessageId,
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

  // Stage 11.6: best-effort scoped retrieval. Failure → empty context; Camp continues.
  const retrieved = await safeRetrieveCampKnowledge({
    userMessage: userContent,
    retrieve: input.retrieveCampKnowledge,
  });
  const knowledgeContext = buildFennKnowledgeContext(retrieved);

  let turn;
  try {
    turn = await runCampCharacterTurn(
      {
        promptKey: character.config.promptKey,
        outlawNumber: input.outlawNumber,
        conversationHistory: prior,
        userMessage: userContent,
        knowledgeContext,
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

  const firstThirtyEligibility = deriveFirstThirtyCampEligibility({
    userMessage: userContent,
    evaluation: normalized.evaluation,
    signals: normalized.signals,
  });

  // Operational diagnostics only — no transcript.
  console.info("[camp_first_thirty_eligibility]", {
    eligible: firstThirtyEligibility.eligible,
    reason: firstThirtyEligibility.reason,
    character: character.slug,
    finalRecommendation: normalized.finalRecommendation,
  });

  let assistantRow = await insertAssistantMessage({
    admin,
    sessionId: session.id,
    profileId: input.profileId,
    characterId: character.row.id,
    content: turn.reply,
    clientMessageHash: assistantHash,
    clientMessageId: input.clientMessageId,
    pairedUserMessageId: userRow.id,
    evaluation: normalized.evaluation,
    firstThirtyEligible: firstThirtyEligibility.eligible,
    firstThirtyEligibilityReason: firstThirtyEligibility.reason,
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
      clientMessageId: input.clientMessageId,
      pairedUserMessageId: userRow.id,
      firstThirty: {
        eligible: firstThirtyEligibility.eligible,
        reason: firstThirtyEligibility.reason,
      },
    },
  });

  await refreshCampSessionCounters(session.id, admin);

  let rewardUnavailable = false;
  let firstThirtyUnavailable = false;
  let granted = 0;
  let firstThirty: SafeFirstThirtyProgress | undefined;
  let suppressCamp = false;

  // First Thirty before ordinary CAMP: active path suppresses per-turn grants.
  try {
    const ft = await applyFirstThirty({
      messageId: assistantRow.id,
      admin,
    });
    firstThirty = ft.progress;
    suppressCamp = ft.suppressOrdinaryCampReward;
  } catch {
    // Prefer conversation continuity; next send can reconcile.
    firstThirtyUnavailable = true;
  }

  if (!suppressCamp) {
    try {
      const rewardResult = await applyReward({
        messageId: assistantRow.id,
        admin,
      });
      granted = rewardResult.actualGrant;
      assistantRow = {
        ...assistantRow,
        reward_granted: granted,
        leaf_ledger_id: rewardResult.ledgerId,
      };
    } catch {
      rewardUnavailable = true;
    }
  } else {
    // Finalise a zero-grant policy so replay does not re-open ordinary reward.
    assistantRow = {
      ...assistantRow,
      reward_granted: 0,
      moderation_flags: {
        ...(assistantRow.moderation_flags ?? {}),
        rewardPolicy: {
          recommended: Number(assistantRow.reward_recommendation ?? 0),
          actual: 0,
          reason: "first_thirty_suppressed",
        },
      },
    };
    try {
      await admin
        .from("camp_messages")
        .update({
          reward_granted: 0,
          moderation_flags: assistantRow.moderation_flags,
        })
        .eq("id", assistantRow.id);
    } catch {
      // Non-fatal; RPC suppress remains true while active.
    }
  }

  // Best-effort memory candidate after reward — never blocks conversation/LEAF.
  if (normalized.evaluation.memoryCandidate) {
    try {
      await applyMemoryCandidate({
        messageId: assistantRow.id,
        admin,
      });
    } catch {
      // Intentionally swallowed.
    }
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
    ...(firstThirtyUnavailable ? { firstThirtyUnavailable: true } : {}),
    reused: Boolean(existingUser),
    ...(firstThirty ? { firstThirty } : {}),
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

async function defaultApplyFirstThirty(input: {
  messageId: string;
  admin: SupabaseClient;
}): Promise<{
  progress: SafeFirstThirtyProgress;
  suppressOrdinaryCampReward: boolean;
  lastEvent?: {
    milestone: "camp_first" | "camp_three" | "first_deed";
    newlySatisfied: boolean;
    nominalGrant: number;
    actualGrant: number;
    greenwoodOpen: boolean;
  };
}> {
  const { applyFirstThirtyCampExchange } = await import(
    "@/lib/first-thirty/service"
  );
  return applyFirstThirtyCampExchange({
    assistantMessageId: input.messageId,
    admin: input.admin,
  });
}

async function defaultApplyMemoryCandidate(input: {
  messageId: string;
  admin: SupabaseClient;
}): Promise<unknown> {
  // Stage 7.5 create + Stage 11.3 best-effort autonomous review.
  // Review failures leave the candidate pending and never fail Camp.
  const { createAndReviewMemoryCandidateFromCampMessage } = await import(
    "@/lib/memory/process"
  );
  return createAndReviewMemoryCandidateFromCampMessage({
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
  clientMessageId: string;
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
      moderation_flags: {
        clientMessageId: input.clientMessageId,
      },
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
  clientMessageId: string;
  pairedUserMessageId: string;
  evaluation: CampContributionEvaluation;
  firstThirtyEligible: boolean;
  firstThirtyEligibilityReason: string;
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
      first_thirty_eligible: input.firstThirtyEligible,
      first_thirty_eligibility_reason: input.firstThirtyEligibilityReason,
      leaf_ledger_id: null,
      moderation_flags: {
        ...input.moderationFlags,
        clientMessageId: input.clientMessageId,
        pairedUserMessageId: input.pairedUserMessageId,
      },
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
