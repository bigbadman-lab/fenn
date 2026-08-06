import "server-only";

import { AgentJudgeError } from "@/lib/agent/judge-errors";
import type { Stage12JudgementIntention } from "@/lib/agent/judge-schema";

export type ClaimedPerception = {
  eventId: string;
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  xCreatedAt: string;
  alreadyJudged: boolean;
};

export type FinalizeJudgementResult = {
  created: boolean;
  judgementId: string;
  action: string;
  reasonCode: string;
};

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function getAdmin(): Promise<AdminLike> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminLike;
}

export async function claimXPerceptionForJudgement(
  deps: { admin?: AdminLike } = {},
): Promise<ClaimedPerception | null> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc("claim_x_perception_for_judgement");

  if (error) {
    throw new AgentJudgeError(
      "judge_claim_failed",
      `claim failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;
  if (
    typeof row.event_id !== "string" ||
    typeof row.x_post_id !== "string" ||
    typeof row.body !== "string"
  ) {
    throw new AgentJudgeError(
      "judge_claim_failed",
      "unexpected claim payload",
      500,
    );
  }

  return {
    eventId: row.event_id,
    xPostId: row.x_post_id,
    perceptionType: String(row.perception_type ?? "mention"),
    authorXUserId: String(row.author_x_user_id ?? ""),
    authorUsername:
      typeof row.author_username === "string" ? row.author_username : null,
    body: row.body,
    xCreatedAt: String(row.x_created_at ?? ""),
    alreadyJudged: Boolean(row.already_judged),
  };
}

export async function finalizeXPerceptionJudgement(
  input: {
    perceptionEventId: string;
    intention: Stage12JudgementIntention;
  },
  deps: { admin?: AdminLike } = {},
): Promise<FinalizeJudgementResult> {
  const admin = deps.admin ?? (await getAdmin());
  const { intention } = input;

  const { data, error } = await admin.rpc("finalize_x_perception_judgement", {
    p_perception_event_id: input.perceptionEventId,
    p_action: intention.action,
    p_reason_code: intention.reasonCode,
    p_engage: intention.engage,
    p_reply_text: intention.replyText,
    p_wall_body: intention.wallBody,
    p_needs_live_state: intention.needsLiveState,
    p_identity_unverified: intention.identityUnverified,
    p_knowledge_available: intention.knowledgeAvailable,
    p_model: intention.model,
    p_prompt_version: intention.promptVersion,
  });

  if (error) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      `finalize failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (
    !row ||
    typeof row.created !== "boolean" ||
    typeof row.judgement_id !== "string" ||
    typeof row.action !== "string" ||
    typeof row.reason_code !== "string"
  ) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      "unexpected finalize payload",
      500,
    );
  }

  return {
    created: row.created,
    judgementId: row.judgement_id,
    action: row.action,
    reasonCode: row.reason_code,
  };
}

export async function failXPerceptionJudgement(
  input: { perceptionEventId: string; error: string },
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const admin = deps.admin ?? (await getAdmin());
  const { error } = await admin.rpc("fail_x_perception_judgement", {
    p_perception_event_id: input.perceptionEventId,
    p_error: input.error,
  });
  if (error) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      `fail mark failed: ${error.message}`,
      500,
    );
  }
}

export type ClaimedStage124LiveJudgement = {
  perceptionEventId: string;
  xPostId: string;
  perceptionType: string;
  authorXUserId: string;
  authorUsername: string | null;
  body: string;
  xCreatedAt: string;
  initialAction: string;
  initialReasonCode: string;
  initialEngage: boolean;
  initialReplyText: string | null;
  initialWallBody: string | null;
  needsLiveState: string[];
  identityUnverified: boolean;
  knowledgeAvailable: boolean;
  initialModel: string;
  initialPromptVersion: string;
  alreadyFinalized: boolean;
};

export type FinalizeStage124LiveJudgementResult = {
  created: boolean;
};

export async function claimXPerceptionJudgementForLiveState(
  deps: { admin?: AdminLike } = {},
): Promise<ClaimedStage124LiveJudgement | null> {
  const admin = deps.admin ?? (await getAdmin());
  const { data, error } = await admin.rpc(
    "claim_x_perception_judgement_for_live_state",
  );

  if (error) {
    throw new AgentJudgeError(
      "judge_claim_failed",
      `claim live-state failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) return null;

  const row = rows[0] as Record<string, unknown>;
  if (typeof row.perception_event_id !== "string") {
    throw new AgentJudgeError(
      "judge_claim_failed",
      "unexpected live-claim payload",
      500,
    );
  }

  return {
    perceptionEventId: row.perception_event_id,
    xPostId: String(row.x_post_id ?? ""),
    perceptionType: String(row.perception_type ?? "mention"),
    authorXUserId: String(row.author_x_user_id ?? ""),
    authorUsername:
      typeof row.author_username === "string" ? row.author_username : null,
    body: String(row.body ?? ""),
    xCreatedAt: String(row.x_created_at ?? ""),
    initialAction: String(row.initial_action ?? ""),
    initialReasonCode: String(row.initial_reason_code ?? ""),
    initialEngage: Boolean(row.initial_engage),
    initialReplyText:
      typeof row.initial_reply_text === "string"
        ? row.initial_reply_text
        : null,
    initialWallBody:
      typeof row.initial_wall_body === "string" ? row.initial_wall_body : null,
    needsLiveState: Array.isArray(row.needs_live_state)
      ? (row.needs_live_state as string[])
      : [],
    identityUnverified: Boolean(row.identity_unverified),
    knowledgeAvailable: Boolean(row.knowledge_available),
    initialModel: String(row.initial_model ?? ""),
    initialPromptVersion: String(row.initial_prompt_version ?? ""),
    alreadyFinalized: Boolean(row.already_finalized),
  };
}

export async function finalizeXPerceptionJudgementWithLiveState(
  input: {
    perceptionEventId: string;
    finalStatus: "finalized" | "failed";
    liveStateAvailable: boolean;
    liveStateSucceeded: string[];
    liveStateFailed: string[];
    finalAction: string;
    finalReasonCode: string;
    finalEngage: boolean;
    finalReplyText: string | null;
    finalWallBody: string | null;
    finalIdentityUnverified: boolean;
    finalModel: string;
    finalPromptVersion: string;
    /** Stage 3 optional structured Wall candidate (normalize before pass). */
    finalWallCandidate?: unknown | null;
  },
  deps: { admin?: AdminLike } = {},
): Promise<FinalizeStage124LiveJudgementResult> {
  const admin = deps.admin ?? (await getAdmin());

  const { data, error } = await admin.rpc(
    "finalize_x_perception_judgement_with_live_state",
    {
      p_perception_event_id: input.perceptionEventId,
      p_final_status: input.finalStatus,
      p_live_state_available: input.liveStateAvailable,
      p_live_state_succeeded: input.liveStateSucceeded,
      p_live_state_failed: input.liveStateFailed,
      p_final_action: input.finalAction,
      p_final_reason_code: input.finalReasonCode,
      p_final_engage: input.finalEngage,
      p_final_reply_text: input.finalReplyText,
      p_final_wall_body: input.finalWallBody,
      p_final_identity_unverified: input.finalIdentityUnverified,
      p_final_model: input.finalModel,
      p_final_prompt_version: input.finalPromptVersion,
      p_final_wall_candidate: input.finalWallCandidate ?? null,
    },
  );

  if (error) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      `finalize live-state failed: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.created !== "boolean") {
    throw new AgentJudgeError(
      "judge_persist_failed",
      "unexpected finalize payload",
      500,
    );
  }

  return { created: row.created };
}

export type PersistedJudgementView = {
  judgementId: string;
  perceptionEventId: string;
  xPostId: string;
  perceptionExcerpt: string;
  action: string;
  reasonCode: string;
  engage: boolean;
  replyText: string | null;
  wallBody: string | null;
  needsLiveState: string[];
  identityUnverified: boolean;
  knowledgeAvailable: boolean;
  model: string;
  promptVersion: string;
  finalStatus: string;
  finalAction: string | null;
  finalReasonCode: string | null;
  finalEngage: boolean;
  finalReplyText: string | null;
  finalWallBody: string | null;
  liveStateAvailable: boolean;
  liveStateSucceeded: string[];
  liveStateFailed: string[];
  perceptionStatus: string;
  createdAt: string;
};

/**
 * Operator inspection — no retrieval metadata / scores.
 */
export async function inspectJudgementByXPostId(
  xPostId: string,
  deps: { admin?: AdminLike } = {},
): Promise<PersistedJudgementView | null> {
  const admin = deps.admin ?? (await getAdmin());
  const trimmed = xPostId.trim();
  if (!trimmed) {
    throw new AgentJudgeError("judge_not_found", "x_post_id required", 400);
  }

  const eventsTable = admin.from("x_perception_events") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: {
            id: string;
            x_post_id: string;
            body: string;
            status: string;
          } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: event, error: eventError } = await eventsTable
    .select("id, x_post_id, body, status")
    .eq("x_post_id", trimmed)
    .maybeSingle();

  if (eventError) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      eventError.message,
      500,
    );
  }
  if (!event) return null;

  const judgementsTable = admin.from("x_perception_judgements") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data: judgement, error: judgementError } = await judgementsTable
    .select(
      "id, perception_event_id, action, reason_code, engage, reply_text, wall_body, needs_live_state, identity_unverified, knowledge_available, model, prompt_version, created_at, final_status, final_action, final_reason_code, final_engage, final_reply_text, final_wall_body, final_identity_unverified, live_state_available, live_state_succeeded, live_state_failed",
    )
    .eq("perception_event_id", event.id)
    .maybeSingle();

  if (judgementError) {
    throw new AgentJudgeError(
      "judge_persist_failed",
      judgementError.message,
      500,
    );
  }
  if (!judgement) return null;

  const excerpt =
    event.body.length > 160 ? `${event.body.slice(0, 160)}…` : event.body;

  return {
    judgementId: String(judgement.id),
    perceptionEventId: event.id,
    xPostId: event.x_post_id,
    perceptionExcerpt: excerpt,
    action: String(judgement.action),
    reasonCode: String(judgement.reason_code),
    engage: Boolean(judgement.engage),
    replyText:
      typeof judgement.reply_text === "string" ? judgement.reply_text : null,
    wallBody:
      typeof judgement.wall_body === "string" ? judgement.wall_body : null,
    needsLiveState: Array.isArray(judgement.needs_live_state)
      ? (judgement.needs_live_state as string[])
      : [],
    identityUnverified: Boolean(judgement.identity_unverified),
    knowledgeAvailable: Boolean(judgement.knowledge_available),
    model: String(judgement.model),
    promptVersion: String(judgement.prompt_version),
    finalStatus: String(judgement.final_status ?? "pending"),
    finalAction:
      typeof judgement.final_action === "string"
        ? judgement.final_action
        : null,
    finalReasonCode:
      typeof judgement.final_reason_code === "string"
        ? judgement.final_reason_code
        : null,
    finalEngage: Boolean(judgement.final_engage),
    finalReplyText:
      typeof judgement.final_reply_text === "string"
        ? judgement.final_reply_text
        : null,
    finalWallBody:
      typeof judgement.final_wall_body === "string"
        ? judgement.final_wall_body
        : null,
    liveStateAvailable: Boolean(judgement.live_state_available),
    liveStateSucceeded: Array.isArray(judgement.live_state_succeeded)
      ? (judgement.live_state_succeeded as string[])
      : [],
    liveStateFailed: Array.isArray(judgement.live_state_failed)
      ? (judgement.live_state_failed as string[])
      : [],
    perceptionStatus: event.status,
    createdAt: String(judgement.created_at),
  };
}
