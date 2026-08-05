/**
 * Load and validate official Market Watch configuration (fail closed).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MARKET_WATCH_CHAIN_ID,
  MARKET_WATCH_CLASSIFICATION_VERSION,
  officialSourceKey,
} from "@/lib/market-watch/config";
import { MarketWatchError } from "@/lib/market-watch/errors";
import { resolveTokenOrder } from "@/lib/market-watch/token-order";
import { POOL_TOKEN_ORDER_ABI, swapTopicForPoolKind } from "@/lib/market-watch/topics";
import type {
  MarketWatchPoolKind,
  MarketWatchTokenOrder,
} from "@/lib/market-watch/types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

export type MarketWatchConfigRow = {
  id: number;
  chain_id: number;
  token_address: string | null;
  token_decimals: number | null;
  token_symbol: string | null;
  pool_address: string | null;
  pool_kind: string | null;
  quote_token_address: string | null;
  quote_token_decimals: number | null;
  quote_token_symbol: string | null;
  launch_block: number | string | null;
  confirmation_depth: number;
  min_display_fenn_raw: number | string;
  classification_version: string;
  enabled: boolean;
};

export type ResolvedMarketWatchConfig = {
  configured: true;
  enabled: boolean;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  tokenAddress: string;
  tokenDecimals: number;
  tokenSymbol: string;
  poolAddress: string;
  poolKind: Exclude<MarketWatchPoolKind, "custom">;
  quoteTokenAddress: string;
  quoteTokenDecimals: number;
  quoteTokenSymbol: string;
  launchBlock: bigint;
  confirmationDepth: number;
  minDisplayFennRaw: bigint;
  classificationVersion: string;
  swapTopic: `0x${string}`;
  tokenOrder: MarketWatchTokenOrder;
  sourceKey: string;
};

export type MarketWatchConfigState =
  | { status: "missing" }
  | { status: "incomplete"; reason: string; enabled: boolean }
  | { status: "invalid"; reason: string; enabled: boolean }
  | { status: "ready"; config: ResolvedMarketWatchConfig };

export type OfficialTokenProbe = {
  chainId: number;
  contractAddress: string;
  decimals: number;
  symbol: string;
};

export type PoolTokenOrderClient = {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof POOL_TOKEN_ORDER_ABI;
    functionName: "token0" | "token1";
  }) => Promise<string>;
};

function asBigInt(value: number | string | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
      return BigInt(value);
    }
    const t = value.trim();
    if (!/^\d+$/.test(t)) return null;
    return BigInt(t);
  } catch {
    return null;
  }
}

function isSupportedLivePoolKind(
  kind: string,
): kind is Exclude<MarketWatchPoolKind, "custom"> {
  return kind === "uniswap_v2" || kind === "uniswap_v3";
}

/**
 * Pure validation of a config row (+ optional on-chain order + official token).
 */
export function validateMarketWatchConfigInput(input: {
  row: MarketWatchConfigRow;
  officialToken?: OfficialTokenProbe | null;
  poolToken0?: string;
  poolToken1?: string;
}): MarketWatchConfigState {
  const { row } = input;
  if (row.chain_id !== MARKET_WATCH_CHAIN_ID) {
    return {
      status: "invalid",
      reason: "chain_id_mismatch",
      enabled: row.enabled,
    };
  }

  const required = [
    row.token_address,
    row.pool_address,
    row.pool_kind,
    row.quote_token_address,
    row.launch_block,
  ];
  if (required.some((v) => v === null || v === undefined || `${v}`.trim() === "")) {
    return {
      status: "incomplete",
      reason: "missing_required_fields",
      enabled: row.enabled,
    };
  }

  let tokenAddress: string;
  let poolAddress: string;
  let quoteTokenAddress: string;
  try {
    tokenAddress = parseEvmAddress(row.token_address!);
    poolAddress = parseEvmAddress(row.pool_address!);
    quoteTokenAddress = parseEvmAddress(row.quote_token_address!);
  } catch {
    return {
      status: "invalid",
      reason: "invalid_address",
      enabled: row.enabled,
    };
  }

  if (
    row.token_decimals == null ||
    !Number.isInteger(row.token_decimals) ||
    row.token_decimals < 0 ||
    row.token_decimals > 255
  ) {
    return {
      status: "invalid",
      reason: "invalid_token_decimals",
      enabled: row.enabled,
    };
  }
  if (
    row.quote_token_decimals == null ||
    !Number.isInteger(row.quote_token_decimals) ||
    row.quote_token_decimals < 0 ||
    row.quote_token_decimals > 255
  ) {
    return {
      status: "invalid",
      reason: "invalid_quote_decimals",
      enabled: row.enabled,
    };
  }

  const poolKindRaw = row.pool_kind!.trim().toLowerCase();
  if (poolKindRaw === "custom") {
    return {
      status: "invalid",
      reason: "custom_pool_unsupported",
      enabled: row.enabled,
    };
  }
  if (!isSupportedLivePoolKind(poolKindRaw)) {
    return {
      status: "invalid",
      reason: "unsupported_pool_kind",
      enabled: row.enabled,
    };
  }

  const launchBlock = asBigInt(row.launch_block);
  if (launchBlock === null) {
    return {
      status: "invalid",
      reason: "invalid_launch_block",
      enabled: row.enabled,
    };
  }

  if (
    !Number.isInteger(row.confirmation_depth) ||
    row.confirmation_depth < 1 ||
    row.confirmation_depth > 64
  ) {
    return {
      status: "invalid",
      reason: "invalid_confirmation_depth",
      enabled: row.enabled,
    };
  }

  const minDisplay = asBigInt(row.min_display_fenn_raw);
  if (minDisplay === null || minDisplay < BigInt(0)) {
    return {
      status: "invalid",
      reason: "invalid_min_display",
      enabled: row.enabled,
    };
  }

  const classificationVersion =
    row.classification_version?.trim() || MARKET_WATCH_CLASSIFICATION_VERSION;

  if (input.officialToken) {
    if (input.officialToken.chainId !== MARKET_WATCH_CHAIN_ID) {
      return {
        status: "invalid",
        reason: "official_token_chain_mismatch",
        enabled: row.enabled,
      };
    }
    let officialAddr: string;
    try {
      officialAddr = parseEvmAddress(input.officialToken.contractAddress);
    } catch {
      return {
        status: "invalid",
        reason: "official_token_invalid",
        enabled: row.enabled,
      };
    }
    if (officialAddr !== tokenAddress) {
      return {
        status: "invalid",
        reason: "token_address_mismatch_official",
        enabled: row.enabled,
      };
    }
    if (input.officialToken.decimals !== row.token_decimals) {
      return {
        status: "invalid",
        reason: "token_decimals_mismatch_official",
        enabled: row.enabled,
      };
    }
  }

  if (!input.poolToken0 || !input.poolToken1) {
    // Allowed for static validation without chain; runtime requires order.
    return {
      status: "incomplete",
      reason: "pool_token_order_unverified",
      enabled: row.enabled,
    };
  }

  const order = resolveTokenOrder({
    token0: input.poolToken0,
    token1: input.poolToken1,
    fennToken: tokenAddress,
    quoteToken: quoteTokenAddress,
  });
  if ("ok" in order && order.ok === false) {
    return {
      status: "invalid",
      reason: order.reason,
      enabled: row.enabled,
    };
  }

  const swapTopic = swapTopicForPoolKind(poolKindRaw);
  if (!swapTopic) {
    return {
      status: "invalid",
      reason: "no_swap_topic",
      enabled: row.enabled,
    };
  }

  return {
    status: "ready",
    config: {
      configured: true,
      enabled: row.enabled,
      chainId: ROBINHOOD_CHAIN_ID,
      tokenAddress,
      tokenDecimals: row.token_decimals,
      tokenSymbol: (row.token_symbol ?? "FENN").trim() || "FENN",
      poolAddress,
      poolKind: poolKindRaw,
      quoteTokenAddress,
      quoteTokenDecimals: row.quote_token_decimals,
      quoteTokenSymbol: (row.quote_token_symbol ?? "QUOTE").trim() || "QUOTE",
      launchBlock,
      confirmationDepth: row.confirmation_depth,
      minDisplayFennRaw: minDisplay,
      classificationVersion,
      swapTopic,
      tokenOrder: order as MarketWatchTokenOrder,
      sourceKey: officialSourceKey(poolAddress),
    },
  };
}

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Load singleton config row. Missing row → missing (seed should exist).
 */
export async function loadMarketWatchConfigRow(
  admin?: SupabaseClient,
): Promise<MarketWatchConfigRow | null> {
  const client = admin ?? (await defaultAdmin());
  const { data, error } = await client
    .from("market_watch_config")
    .select(
      "id, chain_id, token_address, token_decimals, token_symbol, pool_address, pool_kind, quote_token_address, quote_token_decimals, quote_token_symbol, launch_block, confirmation_depth, min_display_fenn_raw, classification_version, enabled",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    throw new MarketWatchError(
      "mw_internal",
      "Failed to load market_watch_config",
      500,
    );
  }
  if (!data) return null;
  return data as MarketWatchConfigRow;
}

/**
 * Resolve ready config with official token match + on-chain token0/token1.
 * Fail closed when addresses present but invalid.
 */
export async function resolveOfficialMarketWatchConfig(options: {
  admin?: SupabaseClient;
  poolClient?: PoolTokenOrderClient | null;
  officialToken?: OfficialTokenProbe | null;
  /** Skip official token check (tests only). */
  skipOfficialTokenCheck?: boolean;
} = {}): Promise<MarketWatchConfigState> {
  const row = await loadMarketWatchConfigRow(options.admin);
  if (!row) return { status: "missing" };

  // Incomplete addresses — incomplete without RPC.
  const hasAddresses =
    row.token_address &&
    isNormalizedEvmAddress(row.token_address.trim().toLowerCase()) &&
    row.pool_address &&
    isNormalizedEvmAddress(row.pool_address.trim().toLowerCase()) &&
    row.quote_token_address &&
    isNormalizedEvmAddress(row.quote_token_address.trim().toLowerCase());

  if (!hasAddresses) {
    return {
      status: "incomplete",
      reason: "missing_required_fields",
      enabled: row.enabled,
    };
  }

  let officialToken = options.officialToken ?? null;
  if (!options.skipOfficialTokenCheck && officialToken === null) {
    try {
      const { getOfficialFennTokenLookup } = await import(
        "@/lib/treasury/official-token"
      );
      const lookup = await getOfficialFennTokenLookup(options.admin);
      if (lookup.status === "ok") {
        officialToken = {
          chainId: lookup.token.chainId,
          contractAddress: lookup.token.contractAddress,
          decimals: lookup.token.decimals,
          symbol: lookup.token.symbol,
        };
      } else {
        // Official token not yet established — allow incomplete pre-launch.
        return {
          status: "incomplete",
          reason: `official_token_${lookup.status}`,
          enabled: row.enabled,
        };
      }
    } catch {
      return {
        status: "incomplete",
        reason: "official_token_lookup_failed",
        enabled: row.enabled,
      };
    }
  }

  let poolToken0 = undefined as string | undefined;
  let poolToken1 = undefined as string | undefined;
  if (options.poolClient) {
    try {
      const pool = parseEvmAddress(row.pool_address!) as `0x${string}`;
      const t0 = await options.poolClient.readContract({
        address: pool,
        abi: POOL_TOKEN_ORDER_ABI,
        functionName: "token0",
      });
      const t1 = await options.poolClient.readContract({
        address: pool,
        abi: POOL_TOKEN_ORDER_ABI,
        functionName: "token1",
      });
      poolToken0 = parseEvmAddress(t0);
      poolToken1 = parseEvmAddress(t1);
    } catch {
      return {
        status: "invalid",
        reason: "pool_token_order_read_failed",
        enabled: row.enabled,
      };
    }
  }

  return validateMarketWatchConfigInput({
    row,
    officialToken: options.skipOfficialTokenCheck
      ? officialToken
      : officialToken,
    poolToken0,
    poolToken1,
  });
}

/**
 * Require ready + enabled for live ingestion ticks.
 */
export function requireRunnableConfig(
  state: MarketWatchConfigState,
): ResolvedMarketWatchConfig {
  if (state.status !== "ready") {
    throw new MarketWatchError(
      state.status === "missing" ? "mw_not_configured" : "mw_config_invalid",
      `Market Watch config ${state.status}`,
      503,
    );
  }
  if (!state.config.enabled) {
    throw new MarketWatchError(
      "mw_not_configured",
      "Market Watch config is disabled",
      503,
    );
  }
  return state.config;
}
