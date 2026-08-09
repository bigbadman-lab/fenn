/**
 * Self-knowledge calibration harness (knowledge-only).
 *
 * Exercises production Stage 11 public_agent retrieval + Stage 12 public
 * judge (Book of Speech) without claim, authorize, execute, X, Purse, or chain.
 */
import "server-only";

import {
  FENN_PUBLIC_AGENT_RETRIEVE_LIMIT,
} from "@/lib/agent/config";
import {
  assemblePublicAgentContext,
} from "@/lib/agent/stage12-contract";
import {
  safeRetrievePublicAgentKnowledge,
  type PublicAgentKnowledgeLookup,
  type PublicAgentKnowledgeRetriever,
} from "@/lib/agent/knowledge";
import {
  runFennPublicJudgement,
  type JudgeModelCaller,
} from "@/lib/agent/judge-model";
import {
  buildFennPublicJudgeSystemPrompt,
  buildFennPublicJudgeUserPayload,
} from "@/lib/agent/judge-prompt";
import { STAGE12_JUDGE_PROMPT_VERSION } from "@/lib/agent/judge-config";
import { AgentJudgeError } from "@/lib/agent/judge-errors";
import type { RetrievedFennKnowledge } from "@/lib/memory/retrieve";
import { retrieveFennKnowledge } from "@/lib/memory/retrieve";
import { createHash } from "node:crypto";

export const SELF_KNOWLEDGE_CALIBRATION_MODE =
  "SELF_KNOWLEDGE_CALIBRATION" as const;

const CALIBRATION_AUTHOR_X_USER_ID = "9000000000000000091";
const TEXT_PREVIEW_CHARS = 280;

export type SelfKnowledgeRetrievalRow = {
  title: string;
  layer: string;
  visibility: string;
  score: number;
  textPreview: string;
  memoryId: string;
  chunkIndex: number;
};

export type SelfKnowledgeCalibrationResult = {
  ok: boolean;
  mode: typeof SELF_KNOWLEDGE_CALIBRATION_MODE;
  question: string;
  retrieval: SelfKnowledgeRetrievalRow[];
  knowledgeAvailable: boolean;
  knowledgeContextChars: number;
  /** Operator hint: agency capabilities sheet content appears in hits. */
  retrievedAgencyCapabilities: boolean;
  /** Operator hint: economy circulation sheet content appears in hits. */
  retrievedEconomyCirculation: boolean;
  replyText: string | null;
  speechAction: string | null;
  reasonCode: string | null;
  responseMode: string | null;
  engage: boolean | null;
  /** Stage 12.3 public judge has no economicAction field — always null here. */
  economicAction: null;
  wallBody: string | null;
  promptVersion: string | null;
  model: string | null;
  /** Always false — harness never persists or executes. */
  sideEffectsAttempted: false;
  xPostAttempted: false;
  chainBroadcastAttempted: false;
  claimAttempted: false;
  authorizeAttempted: false;
  stage126Attempted: false;
  purseCallAttempted: false;
  canonMutated: false;
  memoryWritten: false;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
};

export type SelfKnowledgeCalibrationDeps = {
  retrieve?: PublicAgentKnowledgeRetriever;
  callModel?: JudgeModelCaller;
  /** Soft timeout for knowledge lookup (ms). */
  timeoutMs?: number;
};

function syntheticXPostId(question: string): string {
  const digest = createHash("sha256")
    .update(`self-knowledge:${question.trim()}`)
    .digest("hex");
  const n = Number.parseInt(digest.slice(0, 12), 16) % 1e15;
  return `9091${String(n).padStart(15, "0")}`;
}

function textPreview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= TEXT_PREVIEW_CHARS) return t;
  return `${t.slice(0, TEXT_PREVIEW_CHARS)}…`;
}

export function mapRetrievalRows(
  results: readonly RetrievedFennKnowledge[],
): SelfKnowledgeRetrievalRow[] {
  return results.map((r) => ({
    title: (r.title ?? "").trim() || "(untitled)",
    layer: r.layer,
    visibility: r.visibility,
    score: r.score,
    textPreview: textPreview(r.text),
    memoryId: r.memoryId,
    chunkIndex: r.chunkIndex,
  }));
}

/** Best-effort content match — titles after sync may be “What FENN can do”. */
export function looksLikeAgencyCapabilities(row: {
  title: string;
  text: string;
}): boolean {
  const blob = `${row.title}\n${row.text}`;
  return (
    /What FENN can do/i.test(blob) ||
    /not merely an X bot/i.test(blob) ||
    /fenn\.agency\.capabilities/i.test(blob) ||
    (/finite Purse of FENN under his keeping/i.test(blob) &&
      /does not permanently establish that wallet/i.test(blob))
  );
}

export function looksLikeEconomyCirculation(row: {
  title: string;
  text: string;
}): boolean {
  const blob = `${row.title}\n${row.text}`;
  return (
    /Treasury, Commons, Purse/i.test(blob) ||
    (/THE PURSE/i.test(blob) &&
      /TREASURY/i.test(blob) &&
      /distinct from the Treasury/i.test(blob)) ||
    /what FENN has committed/i.test(blob)
  );
}

function buildDefaultRetriever(limit: number): PublicAgentKnowledgeRetriever {
  return async (args) =>
    retrieveFennKnowledge({
      query: args.query,
      scope: "public_agent",
      // Prefer harness --limit (closure) over production default passed by safeRetrieve.
      limit,
    });
}

/**
 * Knowledge-only probe: public_agent retrieval → public judge → reply.
 * Never claims perceptions, authorises effects, posts to X, or touches Purse.
 */
export async function runSelfKnowledgeCalibration(
  input: {
    text: string;
    /** Override production retrieve limit for operator preview (default 3). */
    limit?: number;
  },
  deps: SelfKnowledgeCalibrationDeps = {},
): Promise<SelfKnowledgeCalibrationResult> {
  const started = Date.now();
  const question = typeof input.text === "string" ? input.text.trim() : "";

  const baseFail = (errorCode: string, errorMessage: string): SelfKnowledgeCalibrationResult => ({
    ok: false,
    mode: SELF_KNOWLEDGE_CALIBRATION_MODE,
    question,
    retrieval: [],
    knowledgeAvailable: false,
    knowledgeContextChars: 0,
    retrievedAgencyCapabilities: false,
    retrievedEconomyCirculation: false,
    replyText: null,
    speechAction: null,
    reasonCode: null,
    responseMode: null,
    engage: null,
    economicAction: null,
    wallBody: null,
    promptVersion: null,
    model: null,
    sideEffectsAttempted: false,
    xPostAttempted: false,
    chainBroadcastAttempted: false,
    claimAttempted: false,
    authorizeAttempted: false,
    stage126Attempted: false,
    purseCallAttempted: false,
    canonMutated: false,
    memoryWritten: false,
    errorCode,
    errorMessage,
    durationMs: Date.now() - started,
  });

  if (!question) {
    return baseFail("invalid_question", "Provide --text with a non-empty question");
  }

  const limit = Math.min(
    20,
    Math.max(1, Math.floor(input.limit ?? FENN_PUBLIC_AGENT_RETRIEVE_LIMIT)),
  );

  let knowledge: PublicAgentKnowledgeLookup;
  try {
    knowledge = await safeRetrievePublicAgentKnowledge({
      query: question,
      retrieve: deps.retrieve ?? buildDefaultRetriever(limit),
      timeoutMs: deps.timeoutMs,
    });
  } catch (error) {
    return baseFail(
      "retrieval_failed",
      error instanceof Error ? error.message : "retrieval failed",
    );
  }

  // Note: safeRetrieve swallows errors into available=false; still proceed to judge.
  const assembled = assemblePublicAgentContext({ knowledge });
  const retrieval = mapRetrievalRows(knowledge.results);
  const retrievedAgencyCapabilities = knowledge.results.some((r) =>
    looksLikeAgencyCapabilities({ title: r.title ?? "", text: r.text }),
  );
  const retrievedEconomyCirculation = knowledge.results.some((r) =>
    looksLikeEconomyCirculation({ title: r.title ?? "", text: r.text }),
  );

  try {
    const intention = await runFennPublicJudgement({
      xPostId: syntheticXPostId(question),
      perceptionType: "mention",
      authorXUserId: CALIBRATION_AUTHOR_X_USER_ID,
      authorUsername: "self_knowledge_calibration",
      body: question,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContext: assembled.knowledgeContext,
      callModel: deps.callModel,
    });

    return {
      ok: true,
      mode: SELF_KNOWLEDGE_CALIBRATION_MODE,
      question,
      retrieval,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContextChars: assembled.knowledgeContext?.length ?? 0,
      retrievedAgencyCapabilities,
      retrievedEconomyCirculation,
      replyText: intention.replyText,
      speechAction: intention.action,
      reasonCode: intention.reasonCode,
      responseMode: intention.responseMode,
      engage: intention.engage,
      economicAction: null,
      wallBody: intention.wallBody,
      promptVersion: intention.promptVersion,
      model: intention.model,
      sideEffectsAttempted: false,
      xPostAttempted: false,
      chainBroadcastAttempted: false,
      claimAttempted: false,
      authorizeAttempted: false,
      stage126Attempted: false,
      purseCallAttempted: false,
      canonMutated: false,
      memoryWritten: false,
      errorCode: null,
      errorMessage: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const errorCode =
      error instanceof AgentJudgeError
        ? error.code
        : "judge_failed";
    const errorMessage =
      error instanceof Error ? error.message : "judgement failed";
    return {
      ...baseFail(errorCode, errorMessage),
      retrieval,
      knowledgeAvailable: assembled.knowledgeAvailable,
      knowledgeContextChars: assembled.knowledgeContext?.length ?? 0,
      retrievedAgencyCapabilities,
      retrievedEconomyCirculation,
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Snapshot builders used by the live path — for tests to assert wiring without I/O.
 */
export function buildSelfKnowledgeJudgePreview(input: {
  question: string;
  knowledgeAvailable: boolean;
  knowledgeContext: string | null;
}): { system: string; user: string; promptVersion: string } {
  const system = buildFennPublicJudgeSystemPrompt();
  const user = buildFennPublicJudgeUserPayload({
    xPostId: syntheticXPostId(input.question),
    perceptionType: "mention",
    authorXUserId: CALIBRATION_AUTHOR_X_USER_ID,
    authorUsername: "self_knowledge_calibration",
    body: input.question,
    knowledgeAvailable: input.knowledgeAvailable,
    knowledgeContext: input.knowledgeContext,
  });
  return {
    system,
    user,
    promptVersion: STAGE12_JUDGE_PROMPT_VERSION,
  };
}
