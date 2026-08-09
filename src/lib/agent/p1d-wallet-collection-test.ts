/**
 * Stage P1D controlled multi-turn wallet collection harness (in-memory capable).
 * Dry-run by default. No real X posts. No chain execution in automated use.
 */

import "server-only";

import { planEconomicEffects } from "@/lib/agent/economic-authority";
import type { EconomicInteractionRow } from "@/lib/agent/economic-interaction";
import {
  resolveEconomicInteractionTtlMs,
} from "@/lib/agent/economic-interaction";
import { harnessPurseState } from "@/lib/agent/p1b-economic-judgement-test";
import {
  planTransferFromConfirmedInteraction,
} from "@/lib/agent/wallet-collection-handler";
import { decideWalletCollectionTurn } from "@/lib/agent/wallet-collection-turn";
import { buildWalletSpeechFallback } from "@/lib/agent/wallet-speech-facts";
import { speechFactsDestinationRequired } from "@/lib/agent/wallet-speech-facts";
import type { FinalEconomicIntent } from "@/lib/agent/economic-intent";
import { createHash, randomUUID } from "node:crypto";

export type P1dTurnReport = {
  turn: number;
  authorXUserId: string;
  /** Synthetic X post id for this turn (null only for origin placeholder). */
  xPostId: string | null;
  body: string;
  kind: string;
  interactionStatus: string | null;
  candidateWallet: string | null;
  confirmedWallet: string | null;
  replyText: string | null;
  plannedTransferAmount: string | null;
  authoritySkippedReason: string | null;
  economicEffects: Array<{
    type: string;
    amountFormatted?: string;
    recipientAddress?: string;
  }>;
};

export type P1dHarnessResult = {
  ok: boolean;
  dryRun: boolean;
  label: string;
  turns: P1dTurnReport[];
  finalInteraction: EconomicInteractionRow | null;
  error?: string;
};

/** In-memory store for harness / unit tests (no Supabase). */
export class InMemoryEconomicInteractionStore {
  private byId = new Map<string, EconomicInteractionRow>();

  list(): EconomicInteractionRow[] {
    return [...this.byId.values()];
  }

  get(id: string): EconomicInteractionRow | null {
    return this.byId.get(id) ?? null;
  }

  findActive(authorXUserId: string): EconomicInteractionRow | null {
    const rows = [...this.byId.values()]
      .filter(
        (r) =>
          r.authorXUserId === authorXUserId &&
          (r.status === "awaiting_wallet" ||
            r.status === "awaiting_wallet_confirmation" ||
            r.status === "wallet_confirmed" ||
            r.status === "executing"),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows[0] ?? null;
  }

  insert(row: EconomicInteractionRow): EconomicInteractionRow {
    if (this.findActive(row.authorXUserId)) {
      throw new Error("active_exists");
    }
    this.byId.set(row.id, row);
    return row;
  }

  update(
    id: string,
    patch: Partial<EconomicInteractionRow>,
  ): EconomicInteractionRow {
    const prev = this.byId.get(id);
    if (!prev) throw new Error("missing_interaction");
    const next = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(id, next);
    return next;
  }
}

function syntheticAuthor(label: string): string {
  const dig = createHash("sha256").update(`p1d-author:${label}`).digest("hex");
  return `9101${dig.slice(0, 15)}`;
}

function syntheticPost(label: string, turn: number): string {
  const dig = createHash("sha256")
    .update(`p1d-post:${label}:${turn}`)
    .digest("hex");
  return `9102${String(turn)}${dig.slice(0, 14)}`;
}

/**
 * Multi-turn dry-run harness using an in-memory store (default) or injected store.
 */
export function runP1dWalletCollectionHarness(input: {
  label: string;
  proposedAmount?: string;
  economicReason?: string;
  /** Ordered user replies — same immutable X user unless turnAuthors overrides. */
  turns: string[];
  turnAuthors?: Array<string | null>;
  dryRun?: boolean;
  /** Creation clock (default: real now). Not mutated globally. */
  now?: Date;
  store?: InMemoryEconomicInteractionStore;
  ttlMs?: number;
  /**
   * Harness-only: for user turns with turn number >= this (1-based; origin is 0),
   * inject a clock to just after interaction.expiresAt into the FSM.
   * Does not change production Date.now or TTL defaults.
   */
  expireBeforeTurn?: number;
}): P1dHarnessResult {
  const dryRun = input.dryRun !== false;
  const label = input.label.trim() || "p1d";
  const authorXUserId = syntheticAuthor(label);
  const proposedAmount = input.proposedAmount ?? "25000";
  const economicReason =
    input.economicReason ?? "verified contribution (harness)";
  const store = input.store ?? new InMemoryEconomicInteractionStore();
  const now = input.now ?? new Date();
  const reports: P1dTurnReport[] = [];

  try {
    const originPost = syntheticPost(label, 0);
    const expiresAt = new Date(
      now.getTime() + (input.ttlMs ?? resolveEconomicInteractionTtlMs()),
    ).toISOString();
    const nowIso = now.toISOString();
    const expireAfterMs =
      typeof input.expireBeforeTurn === "number" &&
      Number.isFinite(input.expireBeforeTurn) &&
      input.expireBeforeTurn >= 1
        ? Math.floor(input.expireBeforeTurn)
        : null;

    let interaction = store.insert({
      id: randomUUID(),
      authorXUserId,
      sourceXPostId: originPost,
      originPerceptionEventId: randomUUID(),
      originJudgementId: null,
      xConversationId: null,
      economicActionType: "transfer_fenn",
      proposedAmount,
      economicReason,
      status: "awaiting_wallet",
      candidateWallet: null,
      confirmedWallet: null,
      candidateSourceXPostId: null,
      confirmationSourceXPostId: null,
      transferEffectId: null,
      lastError: null,
      walletRequestedAt: nowIso,
      walletReceivedAt: null,
      walletConfirmationRequestedAt: null,
      walletConfirmedAt: null,
      expiresAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    reports.push({
      turn: 0,
      authorXUserId,
      xPostId: originPost,
      body: "(origin: transfer intent, no wallet)",
      kind: "pending_destination",
      interactionStatus: interaction.status,
      candidateWallet: null,
      confirmedWallet: null,
      replyText: buildWalletSpeechFallback(
        speechFactsDestinationRequired(proposedAmount),
      ),
      plannedTransferAmount: null,
      authoritySkippedReason: "pending_destination",
      economicEffects: [],
    });

    for (let i = 0; i < input.turns.length; i += 1) {
      const body = input.turns[i] ?? "";
      const turnAuthor = input.turnAuthors?.[i]?.trim() || authorXUserId;
      const xPostId = syntheticPost(label, i + 1);
      const turnNumber = i + 1;

      // Inject post-expiry clock only inside this turn decision (no global Date patch).
      const turnNow =
        expireAfterMs != null && turnNumber >= expireAfterMs
          ? new Date(new Date(interaction.expiresAt).getTime() + 1)
          : now;

      const decision = decideWalletCollectionTurn({
        interaction,
        authorXUserId: turnAuthor,
        body,
        now: turnNow,
      });

      let kind = decision.kind;
      let replyText: string | null =
        decision.speechFacts != null
          ? buildWalletSpeechFallback(decision.speechFacts)
          : null;

      if (decision.kind === "ignored_wrong_user") {
        reports.push({
          turn: i + 1,
          authorXUserId: turnAuthor,
          xPostId,
          body,
          kind,
          interactionStatus: interaction.status,
          candidateWallet: interaction.candidateWallet,
          confirmedWallet: interaction.confirmedWallet,
          replyText: null,
          plannedTransferAmount: null,
          authoritySkippedReason: null,
          economicEffects: [],
        });
        continue;
      }

      if (decision.kind === "expired") {
        interaction = store.update(interaction.id, {
          status: "expired",
          lastError: "expired",
        });
      } else if (
        decision.kind === "candidate_set" ||
        decision.kind === "candidate_replaced"
      ) {
        interaction = store.update(interaction.id, {
          status: "awaiting_wallet_confirmation",
          candidateWallet: decision.candidateWallet,
          candidateSourceXPostId: xPostId,
          walletReceivedAt: nowIso,
          walletConfirmationRequestedAt: nowIso,
        });
      } else if (decision.kind === "back_to_awaiting_wallet") {
        interaction = store.update(interaction.id, {
          status: "awaiting_wallet",
          candidateWallet: null,
          candidateSourceXPostId: null,
        });
      } else if (decision.kind === "confirmed") {
        interaction = store.update(interaction.id, {
          status: "wallet_confirmed",
          confirmedWallet: decision.confirmedWallet,
          candidateWallet: decision.confirmedWallet,
          confirmationSourceXPostId: xPostId,
          walletConfirmedAt: nowIso,
        });
      } else if (
        decision.kind === "remain_awaiting_wallet" ||
        decision.kind === "ambiguous_confirmation"
      ) {
        // status / candidate unchanged
      }

      let plannedTransferAmount: string | null = null;
      let authoritySkippedReason: string | null = null;
      let economicEffects: P1dTurnReport["economicEffects"] = [];

      if (decision.kind === "confirmed" && dryRun) {
        const planned = planTransferFromConfirmedInteraction({
          interaction,
          perceptionEventId: `pe-p1d-${label}-${i + 1}`,
          purseState: harnessPurseState(),
          executionRail: "p1a_test",
          sufficientBalance: true,
        });
        plannedTransferAmount = planned.plannedAmount;
        authoritySkippedReason = planned.skippedReason;
        economicEffects = planned.effects.map((e) => ({
          type: e.type,
          amountFormatted:
            typeof e.payload.amountFormatted === "string"
              ? e.payload.amountFormatted
              : undefined,
          recipientAddress:
            typeof e.payload.recipientAddress === "string"
              ? e.payload.recipientAddress
              : undefined,
        }));

        // Amount immutability check vs user text claiming larger numbers
        if (
          plannedTransferAmount &&
          plannedTransferAmount !== interaction.proposedAmount
        ) {
          throw new Error("amount_mutated");
        }
      }

      reports.push({
        turn: i + 1,
        authorXUserId: turnAuthor,
        xPostId,
        body,
        kind,
        interactionStatus: interaction.status,
        candidateWallet: interaction.candidateWallet,
        confirmedWallet: interaction.confirmedWallet,
        replyText,
        plannedTransferAmount,
        authoritySkippedReason,
        economicEffects,
      });
    }

    // Final pure replan using frozen amount
    if (interaction.status === "wallet_confirmed" && interaction.confirmedWallet) {
      const again = planEconomicEffects({
        economicIntent: {
          type: "transfer_fenn",
          proposedAmount: interaction.proposedAmount,
          reason: interaction.economicReason,
          recipientSource: "trusted_profile_wallet",
        } satisfies Extract<FinalEconomicIntent, { type: "transfer_fenn" }>,
        reasonCode: "answered_from_public_knowledge",
        perceptionEventId: `pe-p1d-final-${label}`,
        interactionConfirmedWallet: interaction.confirmedWallet,
        economicInteractionId: interaction.id,
        purseState: harnessPurseState(),
        executionRail: "p1a_test",
        sufficientBalance: true,
      });
      if (
        again.effects[0] &&
        String(again.effects[0].payload.amountFormatted) !==
          interaction.proposedAmount
      ) {
        throw new Error("amount_mutated_on_replan");
      }
    }

    return {
      ok: true,
      dryRun,
      label,
      turns: reports,
      finalInteraction: interaction,
    };
  } catch (error) {
    return {
      ok: false,
      dryRun,
      label,
      turns: reports,
      finalInteraction: null,
      error: error instanceof Error ? error.message : "p1d_harness_failed",
    };
  }
}
