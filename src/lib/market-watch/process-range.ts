/**
 * Process a confirmed block range: fetch logs → classify → persist → cursor.
 *
 * Failure policy:
 * - Unexpected decode/classification errors on official pool Swap logs →
 *   abort range; do not advance cursor past the failing block (fail closed).
 * - Suppress results (malformed/dust) are durable and do not block the range.
 * - Unrelated topic filter mismatches never enter processing (pre-filtered).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ResolvedMarketWatchConfig } from "@/lib/market-watch/config-loader";
import { writeMarketWatchCursor } from "@/lib/market-watch/cursor";
import { decodeAndClassifySwap, logFromViem } from "@/lib/market-watch/decode";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
import { persistMarketWatchEvent } from "@/lib/market-watch/persist";
import { decideEventStatus } from "@/lib/market-watch/policy";
import {
  fetchOfficialPoolSwapLogs,
  readBlockMeta,
  type MarketWatchRpcClient,
} from "@/lib/market-watch/rpc";
import type { MarketWatchMode } from "@/lib/market-watch/types";

export type ProcessRangeResult = {
  fromBlock: bigint;
  toBlock: bigint;
  logsFetched: number;
  acquisitions: number;
  disposals: number;
  suppressed: number;
  duplicates: number;
  inserted: number;
  cursorAdvancedTo: bigint | null;
};

export type ProcessRangeDeps = {
  admin?: SupabaseClient;
  /** Fetch tx.from for ops only when true. */
  resolveTxFrom?: boolean;
  /** Safe reclassify of observed/suppressed on conflict (CLI only). */
  reclassify?: boolean;
  log?: typeof logMarketWatch;
};

export async function processConfirmedRange(input: {
  mode: MarketWatchMode;
  config: ResolvedMarketWatchConfig;
  rpc: MarketWatchRpcClient;
  fromBlock: bigint;
  toBlock: bigint;
  /** Advance cursor after success (worker live/dry). Replay may skip. */
  advanceCursor?: boolean;
  deps?: ProcessRangeDeps;
}): Promise<ProcessRangeResult> {
  const { mode, config, rpc, fromBlock, toBlock } = input;
  const advanceCursor = input.advanceCursor !== false;
  const log = input.deps?.log ?? logMarketWatch;

  if (mode === "disabled") {
    throw new MarketWatchError("mw_disabled", "Market Watch is disabled", 400);
  }
  if (fromBlock > toBlock) {
    throw new MarketWatchError("mw_range_invalid", "Invalid block range", 400);
  }

  const {
    logs,
    effectiveToBlock,
    rangeUsed,
  } = await fetchOfficialPoolSwapLogs({
    rpc,
    poolAddress: config.poolAddress,
    swapTopic: config.swapTopic,
    fromBlock,
    toBlock,
  });

  log({
    event: "logs_fetched",
    ok: true,
    mode,
    fromBlock: fromBlock.toString(),
    toBlock: effectiveToBlock.toString(),
    logCount: logs.length,
    detail: `range=${rangeUsed}`,
  });

  // Sort for deterministic processing.
  const sorted = [...logs].sort((a, b) => {
    const bn = Number(
      (a.blockNumber ?? BigInt(0)) - (b.blockNumber ?? BigInt(0)),
    );
    if (bn !== 0) return bn;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  let acquisitions = 0;
  let disposals = 0;
  let suppressed = 0;
  let duplicates = 0;
  let inserted = 0;

  const blockMetaCache = new Map<
    string,
    { hash: string | null; timestamp: string | null }
  >();

  async function metaFor(blockNumber: bigint) {
    const key = blockNumber.toString();
    const hit = blockMetaCache.get(key);
    if (hit) return hit;
    const meta = await readBlockMeta(rpc, blockNumber);
    blockMetaCache.set(key, meta);
    return meta;
  }

  for (const raw of sorted) {
    const canon = logFromViem(raw);
    if (!canon) {
      log({
        event: "classification_error",
        ok: false,
        code: "incomplete_log",
        detail: "missing block/tx/log index",
      });
      throw new MarketWatchError(
        "mw_classification_fatal",
        "Incomplete log from RPC — cursor not advanced",
        502,
      );
    }

    const classified = decodeAndClassifySwap({
      log: canon,
      poolKind: config.poolKind,
      expectedPool: config.poolAddress,
      expectedTopic: config.swapTopic,
      order: config.tokenOrder,
      classificationVersion: config.classificationVersion,
    });

    if (classified.kind === "error") {
      // Malformed canonical Swap at official pool — not dust suppress.
      log({
        event: "classification_error",
        ok: false,
        code: classified.reason,
        transactionHash: canon.transactionHash,
        logIndex: canon.logIndex,
        fromBlock: canon.blockNumber.toString(),
        detail: "cursor_not_advanced",
      });
      throw new MarketWatchError(
        "mw_classification_fatal",
        `Classification fatal at ${canon.transactionHash}:${canon.logIndex} (${classified.reason})`,
        500,
      );
    }

    let eventType = classified.eventType!;
    let fennAmountRaw = classified.fennAmountRaw ?? BigInt(0);
    let quoteAmountRaw = classified.quoteAmountRaw ?? BigInt(0);
    let alreadySuppressed = classified.kind === "suppress";
    let suppressReason =
      classified.kind === "suppress" ? classified.reason : null;

    if (classified.kind === "ok") {
      eventType = classified.eventType;
      fennAmountRaw = classified.fennAmountRaw;
      quoteAmountRaw = classified.quoteAmountRaw;
      if (eventType === "acquisition") acquisitions += 1;
      else disposals += 1;
    } else {
      suppressed += 1;
      // For pure suppress without amounts, store zero + suppress.
      eventType = classified.eventType ?? "disposal";
      fennAmountRaw = classified.fennAmountRaw ?? BigInt(0);
      quoteAmountRaw = classified.quoteAmountRaw ?? BigInt(0);
    }

    const decision = decideEventStatus({
      mode,
      eventType,
      fennAmountRaw,
      minDisplayFennRaw: config.minDisplayFennRaw,
      alreadySuppressed,
      suppressReason,
    });

    if (decision.status === "suppressed" && !alreadySuppressed) {
      suppressed += 1;
    }

    const meta = await metaFor(canon.blockNumber);

    let txFrom: string | null = null;
    if (input.deps?.resolveTxFrom && rpc.getTransaction) {
      try {
        const tx = await rpc.getTransaction({
          hash: canon.transactionHash as `0x${string}`,
        });
        txFrom = tx?.from?.toLowerCase() ?? null;
      } catch {
        txFrom = null;
      }
    }

    const persistResult = await persistMarketWatchEvent(
      {
        chainId: config.chainId,
        eventType,
        tokenAddress: config.tokenAddress,
        poolAddress: config.poolAddress,
        quoteTokenAddress: config.quoteTokenAddress,
        transactionHash: canon.transactionHash,
        logIndex: canon.logIndex,
        blockNumber: canon.blockNumber,
        blockHash: meta.hash ?? canon.blockHash,
        blockTimestamp: meta.timestamp,
        fennAmountRaw,
        quoteAmountRaw,
        txFrom,
        classificationVersion: config.classificationVersion,
        status: decision.status,
        suppressReason: decision.suppressReason,
        publishedAt: decision.publishedAt,
        rawLog: {
          topics: canon.topics.slice(0, 4),
          // Bound data length for storage.
          data: canon.data.slice(0, 200),
        },
      },
      input.deps?.admin,
      { reclassify: input.deps?.reclassify === true },
    );

    if (persistResult.outcome === "duplicate") {
      duplicates += 1;
      log({
        event: "duplicate",
        ok: true,
        transactionHash: canon.transactionHash,
      });
    } else {
      inserted += 1;
    }
  }

  // Cursor only advances through the range we actually scanned.
  const cursorTo = effectiveToBlock;
  let cursorAdvancedTo: bigint | null = null;
  if (advanceCursor) {
    const endMeta = await metaFor(cursorTo);
    await writeMarketWatchCursor(
      {
        sourceKey: config.sourceKey,
        chainId: config.chainId,
        poolAddress: config.poolAddress,
        lastSafeBlock: cursorTo,
        lastSafeBlockHash: endMeta.hash,
        classificationVersion: config.classificationVersion,
      },
      input.deps?.admin,
    );
    cursorAdvancedTo = cursorTo;
    log({
      event: "cursor_advanced",
      ok: true,
      mode,
      toBlock: cursorTo.toString(),
    });
  }

  log({
    event: "classified",
    ok: true,
    mode,
    acquisitions,
    disposals,
    suppressed,
    duplicates,
  });

  return {
    fromBlock,
    toBlock: cursorTo,
    logsFetched: logs.length,
    acquisitions,
    disposals,
    suppressed,
    duplicates,
    inserted,
    cursorAdvancedTo,
  };
}
