/**
 * Reorg recovery: find common ancestor, mark events reorged, rewind cursor.
 *
 * Published acquisitions become status=reorged (not deleted). Clearing feed
 * only shows status=published, so they drop from the public room on next poll.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeMarketWatchCursor } from "@/lib/market-watch/cursor";
import type { MarketWatchCursor } from "@/lib/market-watch/cursor";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { logMarketWatch } from "@/lib/market-watch/log";
import type { MarketWatchRpcClient } from "@/lib/market-watch/rpc";
import { readBlockMeta } from "@/lib/market-watch/rpc";
import { MARKET_WATCH_REORG_MAX_REWIND_BLOCKS } from "@/lib/market-watch/thresholds";

export type CommonAncestor = {
  blockNumber: bigint;
  blockHash: string;
  stepsWalked: number;
};

export type KnownBlockHash = {
  blockNumber: bigint;
  blockHash: string;
};

/**
 * Pure walk plan: block numbers to probe [cursor, cursor-1, …] within limit.
 */
export function reorgWalkPlan(
  lastSafeBlock: bigint,
  maxRewind: number = MARKET_WATCH_REORG_MAX_REWIND_BLOCKS,
): bigint[] {
  if (lastSafeBlock < BigInt(0)) return [];
  const out: bigint[] = [];
  const limit = BigInt(Math.max(1, maxRewind));
  let b = lastSafeBlock;
  let walked = BigInt(0);
  while (walked <= limit && b >= BigInt(0)) {
    out.push(b);
    if (b === BigInt(0) || walked === limit) break;
    b = b - BigInt(1);
    walked = walked + BigInt(1);
  }
  return out;
}

/**
 * Index known stored hashes (cursor + event block hashes) for ancestor search.
 */
export function knownHashMap(
  known: KnownBlockHash[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of known) {
    m.set(k.blockNumber.toString(), k.blockHash.toLowerCase());
  }
  return m;
}

/**
 * Find newest block ≤ lastSafe where the on-chain hash matches a hash we stored
 * (cursor tip and/or event rows). Bounded walk; null = stall for operator.
 */
export async function findCommonAncestor(input: {
  rpc: MarketWatchRpcClient;
  lastSafeBlock: bigint;
  lastSafeBlockHash: string | null;
  maxRewind?: number;
  /** Known good hashes (events / prior). Cursor tip is also checked. */
  knownHashes?: KnownBlockHash[];
}): Promise<CommonAncestor | null> {
  const maxRewind = input.maxRewind ?? MARKET_WATCH_REORG_MAX_REWIND_BLOCKS;
  const plan = reorgWalkPlan(input.lastSafeBlock, maxRewind);
  if (plan.length === 0) return null;

  const known = knownHashMap(input.knownHashes ?? []);
  if (input.lastSafeBlockHash) {
    known.set(
      input.lastSafeBlock.toString(),
      input.lastSafeBlockHash.toLowerCase(),
    );
  }

  // Index 0 is the cursor tip — confirm match.
  const tipMeta = await readBlockMeta(input.rpc, plan[0]!);
  if (
    input.lastSafeBlockHash &&
    tipMeta.hash &&
    tipMeta.hash.toLowerCase() === input.lastSafeBlockHash.toLowerCase()
  ) {
    return {
      blockNumber: plan[0]!,
      blockHash: tipMeta.hash,
      stepsWalked: 0,
    };
  }

  // Walk parents; require stored hash equal chain hash for a true common ancestor.
  for (let i = 1; i < plan.length; i++) {
    const blockNumber = plan[i]!;
    const meta = await readBlockMeta(input.rpc, blockNumber);
    if (!meta.hash) continue;
    const stored = known.get(blockNumber.toString());
    if (stored && stored === meta.hash.toLowerCase()) {
      return {
        blockNumber,
        blockHash: meta.hash,
        stepsWalked: i,
      };
    }
  }

  return null;
}

/**
 * Load distinct block_hash values for this pool at/below the cursor.
 */
export async function loadKnownEventBlockHashes(input: {
  admin: SupabaseClient;
  chainId: number;
  poolAddress: string;
  maxBlock: bigint;
  limit?: number;
}): Promise<KnownBlockHash[]> {
  const limit = input.limit ?? MARKET_WATCH_REORG_MAX_REWIND_BLOCKS + 8;
  const { data, error } = await input.admin
    .from("market_watch_events")
    .select("block_number, block_hash")
    .eq("chain_id", input.chainId)
    .eq("pool_address", input.poolAddress.toLowerCase())
    .lte("block_number", input.maxBlock.toString())
    .not("block_hash", "is", null)
    .order("block_number", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) return [];

  const out: KnownBlockHash[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const bn = String(row.block_number);
    if (seen.has(bn)) continue;
    const hash = row.block_hash ? String(row.block_hash).toLowerCase() : null;
    if (!hash || !/^0x[a-f0-9]{64}$/.test(hash)) continue;
    seen.add(bn);
    try {
      out.push({ blockNumber: BigInt(bn), blockHash: hash });
    } catch {
      // skip bad row
    }
  }
  return out;
}

export async function markEventsReorgedAfter(input: {
  admin: SupabaseClient;
  chainId: number;
  poolAddress: string;
  /** Events with block_number > this are marked reorged. */
  afterBlock: bigint;
}): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await input.admin
    .from("market_watch_events")
    .update({
      status: "reorged",
      reorged_at: now,
      published_at: null,
      updated_at: now,
    })
    .eq("chain_id", input.chainId)
    .eq("pool_address", input.poolAddress.toLowerCase())
    .gt("block_number", input.afterBlock.toString())
    .neq("status", "reorged")
    .select("id");

  if (error) {
    throw new MarketWatchError(
      "mw_persist_failed",
      "Failed to mark reorged market events",
      500,
    );
  }
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Pure view of which event statuses would leave The Clearing after reorg mark.
 * Used by unit tests — feed filters status=published only.
 */
export function remainsInClearingAfterReorg(status: string): boolean {
  return status === "published";
}

export type ReorgRecoveryResult =
  | {
      outcome: "no_reorg";
    }
  | {
      outcome: "recovered";
      ancestorBlock: bigint;
      ancestorHash: string;
      eventsMarked: number;
      stepsWalked: number;
    }
  | {
      outcome: "stalled";
      reason: "rewind_limit" | "no_ancestor";
    };

/**
 * Full recovery path when cursor hash no longer matches chain.
 */
export async function recoverFromCursorReorg(input: {
  rpc: MarketWatchRpcClient;
  cursor: MarketWatchCursor;
  admin: SupabaseClient;
  maxRewind?: number;
  log?: typeof logMarketWatch;
  knownHashes?: KnownBlockHash[];
}): Promise<ReorgRecoveryResult> {
  const log = input.log ?? logMarketWatch;
  log({
    event: "reorg_detected",
    ok: false,
    code: "mw_cursor_reorg",
    toBlock: input.cursor.lastSafeBlock.toString(),
  });

  if (!input.cursor.lastSafeBlockHash) {
    log({
      event: "reorg_stall",
      ok: false,
      code: "mw_reorg_stall",
      detail: "no_cursor_hash",
    });
    return { outcome: "stalled", reason: "no_ancestor" };
  }

  let known = input.knownHashes;
  if (known === undefined) {
    known = await loadKnownEventBlockHashes({
      admin: input.admin,
      chainId: input.cursor.chainId,
      poolAddress: input.cursor.poolAddress,
      maxBlock: input.cursor.lastSafeBlock,
      limit: (input.maxRewind ?? MARKET_WATCH_REORG_MAX_REWIND_BLOCKS) + 8,
    });
  }

  const ancestor = await findCommonAncestor({
    rpc: input.rpc,
    lastSafeBlock: input.cursor.lastSafeBlock,
    lastSafeBlockHash: input.cursor.lastSafeBlockHash,
    maxRewind: input.maxRewind,
    knownHashes: known,
  });

  if (!ancestor) {
    log({
      event: "reorg_stall",
      ok: false,
      code: "mw_reorg_stall",
      detail: "rewind_limit_or_no_ancestor",
    });
    return { outcome: "stalled", reason: "rewind_limit" };
  }

  if (ancestor.stepsWalked === 0) {
    return { outcome: "no_reorg" };
  }

  const eventsMarked = await markEventsReorgedAfter({
    admin: input.admin,
    chainId: input.cursor.chainId,
    poolAddress: input.cursor.poolAddress,
    afterBlock: ancestor.blockNumber,
  });

  await writeMarketWatchCursor(
    {
      sourceKey: input.cursor.sourceKey,
      chainId: input.cursor.chainId,
      poolAddress: input.cursor.poolAddress,
      lastSafeBlock: ancestor.blockNumber,
      lastSafeBlockHash: ancestor.blockHash,
      classificationVersion: input.cursor.classificationVersion,
    },
    input.admin,
  );

  log({
    event: "reorg_recovered",
    ok: true,
    code: "mw_reorg_recovered",
    toBlock: ancestor.blockNumber.toString(),
    detail: `marked=${eventsMarked} steps=${ancestor.stepsWalked}`,
  });

  return {
    outcome: "recovered",
    ancestorBlock: ancestor.blockNumber,
    ancestorHash: ancestor.blockHash,
    eventsMarked,
    stepsWalked: ancestor.stepsWalked,
  };
}
