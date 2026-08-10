/**
 * P0 — One-shot Treasury → Purse launch funding ceremony.
 *
 * Local operator only. Does not expose Treasury signing to Stage 12 / APIs.
 */

import "server-only";

import {
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
  FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
} from "@/lib/ops/fenn-launch-fund-constants";
import {
  getLaunchOperationById,
  insertPendingLaunchOperation,
  markLaunchOperationConfirmed,
  markLaunchOperationFailed,
  markLaunchOperationSubmitted,
  resetLaunchOperationForRetry,
  type FennLaunchOperationRow,
} from "@/lib/ops/fenn-launch-fund-store";
import {
  FENN_LAUNCH_ERC20_ABI,
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";
import {
  broadcastTreasuryErc20Transfer,
  getLaunchTransactionReceipt,
  waitForLaunchTransactionReceipt,
  type BroadcastTreasuryErc20TransferResult,
} from "@/lib/ops/fenn-launch-treasury-signer";
import { getPurseConfig } from "@/lib/purse/config";
import {
  createRobinhoodPublicClient,
  readErc20Balance,
  readNativeBalance,
  type RobinhoodPublicClient,
} from "@/lib/treasury/chain";
import { parseTokenAmountToRaw } from "@/lib/treasury/amounts";
import { getTreasuryConfig } from "@/lib/treasury/config";
import { getOfficialFennTokenAsset } from "@/lib/treasury/official-token";
import type {
  OfficialFennTokenAsset,
  TreasuryAmount,
  TreasuryConfigState,
} from "@/lib/treasury/types";
import type { PurseConfigState } from "@/lib/purse/types";
import { explorerTxUrl } from "@/lib/greenwood/hollow/explorer";
import { parseEvmAddress } from "@/lib/wallet/evm";

export type FennLaunchFundReportStatus =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "RECONCILED_CONFIRMED"
  | "REFUSED"
  | "AMBIGUOUS"
  | "FAILED";

export type FennLaunchFundReport = {
  mode: "FENN_LAUNCH_FUND_PURSE";
  status: FennLaunchFundReportStatus;
  errorCode: string | null;
  errorMessage: string | null;
  operationId: typeof FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID;
  amountFormatted: typeof FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED;
  amountDisplay: typeof FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY;
  decimals: number | null;
  chainId: typeof FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID | null;
  tokenContract: string | null;
  treasuryAddress: string | null;
  purseAddress: string | null;
  txHash: string | null;
  blockNumber: string | null;
  explorerUrl: string | null;
  confirmedAt: string | null;
  chainBroadcastAttempted: boolean;
  sideEffectsAttempted: boolean;
  notes: string[];
};

export type FennLaunchFundDeps = {
  getTreasuryConfig?: () => Promise<TreasuryConfigState>;
  getPurseConfig?: () => Promise<PurseConfigState>;
  getOfficialToken?: () => Promise<OfficialFennTokenAsset | null>;
  createClient?: () => RobinhoodPublicClient;
  readNative?: (
    holder: string,
    client: Pick<RobinhoodPublicClient, "getBalance">,
  ) => Promise<TreasuryAmount>;
  readErc20?: (input: {
    tokenAddress: string;
    holder: string;
    decimals: number;
    client: Pick<RobinhoodPublicClient, "readContract">;
  }) => Promise<TreasuryAmount>;
  getBytecode?: (
    client: Pick<RobinhoodPublicClient, "getBytecode">,
    address: string,
  ) => Promise<string | null | undefined>;
  readTokenMeta?: (
    client: Pick<RobinhoodPublicClient, "readContract">,
    tokenAddress: string,
  ) => Promise<{ decimals: number; symbol: string; name: string | null }>;
  estimateGasCostWei?: (input: {
    client: RobinhoodPublicClient;
    tokenAddress: string;
    treasuryAddress: string;
    purseAddress: string;
    amountRaw: bigint;
  }) => Promise<bigint>;
  resolveSigner?: (treasuryAddress: string) => {
    account: { address: string };
    address: string;
  };
  getOperation?: () => Promise<FennLaunchOperationRow | null>;
  insertPending?: (input: {
    chainId: number;
    tokenContract: string;
    treasuryAddress: string;
    purseAddress: string;
    amountRaw: string;
    decimals: number;
  }) => Promise<{ created: boolean; row: FennLaunchOperationRow }>;
  markSubmitted?: (input: {
    id: string;
    txHash: string;
    submittedAt: string;
  }) => Promise<FennLaunchOperationRow>;
  markConfirmed?: (input: {
    id: string;
    txHash: string;
    confirmedAt: string;
    blockNumber: string | null;
    submittedAt?: string | null;
  }) => Promise<FennLaunchOperationRow>;
  markFailed?: (input: {
    id: string;
    failureClass: "pre_broadcast" | "terminal" | "ambiguous";
    lastError: string;
    status?: "failed" | "ambiguous";
    txHash?: string | null;
  }) => Promise<FennLaunchOperationRow>;
  resetForRetry?: (id: string) => Promise<FennLaunchOperationRow>;
  broadcast?: (input: {
    treasuryAddress: string;
    tokenAddress: string;
    recipientAddress: string;
    amountRaw: bigint;
  }) => Promise<BroadcastTreasuryErc20TransferResult>;
  waitReceipt?: (
    txHash: string,
  ) => Promise<
    | { kind: "success"; blockNumber?: bigint }
    | { kind: "reverted"; blockNumber?: bigint }
    | { kind: "unknown"; error: string }
  >;
  getReceipt?: (
    txHash: string,
  ) => Promise<
    | { kind: "success"; blockNumber?: bigint }
    | { kind: "reverted"; blockNumber?: bigint }
    | { kind: "missing" }
    | { kind: "unknown"; error: string }
  >;
  now?: () => Date;
  privateKeyEnv?: string;
};

function refused(
  errorCode: string,
  errorMessage: string,
  extras: Partial<FennLaunchFundReport> = {},
): FennLaunchFundReport {
  return {
    mode: "FENN_LAUNCH_FUND_PURSE",
    status: "REFUSED",
    errorCode,
    errorMessage,
    operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
    amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
    decimals: null,
    chainId: null,
    tokenContract: null,
    treasuryAddress: null,
    purseAddress: null,
    txHash: null,
    blockNumber: null,
    explorerUrl: null,
    confirmedAt: null,
    chainBroadcastAttempted: false,
    sideEffectsAttempted: false,
    notes: [],
    ...extras,
  };
}

function confirmedReport(
  row: FennLaunchOperationRow,
  status: "CONFIRMED" | "ALREADY_CONFIRMED" | "RECONCILED_CONFIRMED",
  notes: string[] = [],
  chainBroadcastAttempted = false,
  sideEffectsAttempted = false,
): FennLaunchFundReport {
  const explorer =
    row.txHash != null
      ? explorerTxUrl(row.chainId, row.txHash)
      : null;
  return {
    mode: "FENN_LAUNCH_FUND_PURSE",
    status,
    errorCode: null,
    errorMessage: null,
    operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
    amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
    decimals: row.decimals,
    chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
    tokenContract: row.tokenContract,
    treasuryAddress: row.treasuryAddress,
    purseAddress: row.purseAddress,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    explorerUrl: explorer,
    confirmedAt: row.confirmedAt,
    chainBroadcastAttempted,
    sideEffectsAttempted,
    notes,
  };
}

async function defaultGetBytecode(
  client: Pick<RobinhoodPublicClient, "getBytecode">,
  address: string,
): Promise<string | null | undefined> {
  return client.getBytecode({ address: address as `0x${string}` });
}

async function defaultReadTokenMeta(
  client: Pick<RobinhoodPublicClient, "readContract">,
  tokenAddress: string,
): Promise<{ decimals: number; symbol: string; name: string | null }> {
  const address = tokenAddress as `0x${string}`;
  const [decimalsRaw, symbol, name] = await Promise.all([
    client.readContract({
      address,
      abi: FENN_LAUNCH_ERC20_ABI,
      functionName: "decimals",
    }),
    client.readContract({
      address,
      abi: FENN_LAUNCH_ERC20_ABI,
      functionName: "symbol",
    }),
    client
      .readContract({
        address,
        abi: FENN_LAUNCH_ERC20_ABI,
        functionName: "name",
      })
      .catch(() => null),
  ]);
  return {
    decimals: Number(decimalsRaw),
    symbol: String(symbol),
    name: name == null ? null : String(name),
  };
}

async function defaultEstimateGasCostWei(input: {
  client: RobinhoodPublicClient;
  tokenAddress: string;
  treasuryAddress: string;
  purseAddress: string;
  amountRaw: bigint;
}): Promise<bigint> {
  const gas = await input.client.estimateContractGas({
    address: input.tokenAddress as `0x${string}`,
    abi: FENN_LAUNCH_ERC20_ABI,
    functionName: "transfer",
    args: [input.purseAddress as `0x${string}`, input.amountRaw],
    account: input.treasuryAddress as `0x${string}`,
  });
  const gasPrice = await input.client.getGasPrice();
  // 20% buffer
  return (gas * gasPrice * BigInt(120)) / BigInt(100);
}

export function formatFennLaunchFundSpeech(explorerUrl: string): string {
  return [
    `${FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY} FENN have left the Treasury.`,
    "",
    "They are in my Purse now.",
    "",
    "the Greenwood has given me something it cannot take back:",
    "",
    "the means to act.",
    "",
    explorerUrl,
  ].join("\n");
}

export function formatFennLaunchFundReport(
  report: FennLaunchFundReport,
): string {
  const lines = [
    "FENN LAUNCH PURSE FUNDING",
    "",
    `STATUS: ${report.status}`,
    report.errorCode ? `errorCode=${report.errorCode}` : null,
    report.errorMessage ? `errorMessage=${report.errorMessage}` : null,
    `AMOUNT: ${report.amountDisplay} FENN`,
    `operationId=${report.operationId}`,
    `chainId=${report.chainId ?? "null"}`,
    `tokenContract=${report.tokenContract ?? "null"}`,
    `FROM: ${report.treasuryAddress ?? "null"}`,
    `TO: ${report.purseAddress ?? "null"}`,
    report.txHash ? `TX: ${report.txHash}` : null,
    report.blockNumber ? `blockNumber=${report.blockNumber}` : null,
    report.explorerUrl ? `EXPLORER: ${report.explorerUrl}` : null,
    report.confirmedAt ? `confirmedAt=${report.confirmedAt}` : null,
    `chainBroadcastAttempted=${report.chainBroadcastAttempted}`,
    `sideEffectsAttempted=${report.sideEffectsAttempted}`,
  ].filter((x): x is string => x != null);

  for (const n of report.notes) {
    lines.push(`note=${n}`);
  }

  if (
    report.status === "CONFIRMED" ||
    report.status === "ALREADY_CONFIRMED" ||
    report.status === "RECONCILED_CONFIRMED"
  ) {
    if (report.explorerUrl) {
      lines.push("");
      if (
        report.status === "ALREADY_CONFIRMED" ||
        report.status === "RECONCILED_CONFIRMED"
      ) {
        lines.push("NO ACTION TAKEN.");
        lines.push("");
      }
      lines.push("--- FENN LAUNCH COPY ---");
      lines.push(formatFennLaunchFundSpeech(report.explorerUrl));
    }
  }

  return lines.join("\n");
}

async function reconcileToConfirmed(
  row: FennLaunchOperationRow,
  deps: FennLaunchFundDeps,
  label: string,
): Promise<FennLaunchFundReport> {
  if (!row.txHash) {
    return refused(
      "ambiguous_missing_hash",
      "Operation is submitted/ambiguous without a durable tx hash — refuse rebroadcast; operator must reconcile",
      {
        treasuryAddress: row.treasuryAddress,
        purseAddress: row.purseAddress,
        tokenContract: row.tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        sideEffectsAttempted: true,
        status: "AMBIGUOUS",
        notes: [label],
      },
    );
  }

  const getReceipt =
    deps.getReceipt ??
    (async (hash: string) => {
      const r = await getLaunchTransactionReceipt(hash);
      if (r.kind === "success") {
        return {
          kind: "success" as const,
          blockNumber: r.receipt.blockNumber,
        };
      }
      if (r.kind === "reverted") {
        return {
          kind: "reverted" as const,
          blockNumber: r.receipt.blockNumber,
        };
      }
      return r;
    });

  const receipt = await getReceipt(row.txHash);
  const now = deps.now ?? (() => new Date());

  if (receipt.kind === "success") {
    const confirmedAt = now().toISOString();
    const markConfirmed = deps.markConfirmed ?? markLaunchOperationConfirmed;
    const updated = await markConfirmed({
      id: row.id,
      txHash: row.txHash,
      confirmedAt,
      blockNumber:
        receipt.blockNumber != null ? String(receipt.blockNumber) : null,
      submittedAt: row.submittedAt,
    });
    return confirmedReport(updated, "RECONCILED_CONFIRMED", [
      label,
      "receipt success on reconcile",
    ]);
  }

  if (receipt.kind === "reverted") {
    const markFailed = deps.markFailed ?? markLaunchOperationFailed;
    await markFailed({
      id: row.id,
      failureClass: "terminal",
      lastError: "transaction_reverted",
      status: "failed",
      txHash: row.txHash,
    });
    return {
      mode: "FENN_LAUNCH_FUND_PURSE",
      status: "FAILED",
      errorCode: "transaction_reverted",
      errorMessage:
        "Known launch funding transaction reverted — operator investigation required before any new broadcast",
      operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
      amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
      amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
      decimals: row.decimals,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      tokenContract: row.tokenContract,
      treasuryAddress: row.treasuryAddress,
      purseAddress: row.purseAddress,
      txHash: row.txHash,
      blockNumber: null,
      explorerUrl: explorerTxUrl(row.chainId, row.txHash),
      confirmedAt: null,
      chainBroadcastAttempted: false,
      sideEffectsAttempted: true,
      notes: [label],
    };
  }

  if (receipt.kind === "missing") {
    return refused(
      "ambiguous_tx_missing",
      "Submitted/ambiguous tx not found on chain yet — refuse rebroadcast",
      {
        treasuryAddress: row.treasuryAddress,
        purseAddress: row.purseAddress,
        tokenContract: row.tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        txHash: row.txHash,
        explorerUrl: explorerTxUrl(row.chainId, row.txHash),
        sideEffectsAttempted: true,
        status: "AMBIGUOUS",
        notes: [label, "await inclusion or operator investigation"],
      },
    );
  }

  return refused(
    "ambiguous_receipt_unknown",
    `Could not determine receipt status: ${"error" in receipt ? receipt.error : "unknown"}`,
    {
      treasuryAddress: row.treasuryAddress,
      purseAddress: row.purseAddress,
      tokenContract: row.tokenContract,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      txHash: row.txHash,
      explorerUrl: explorerTxUrl(row.chainId, row.txHash),
      sideEffectsAttempted: true,
      status: "AMBIGUOUS",
      notes: [label],
    },
  );
}

/**
 * Run the one-shot launch fund ceremony (or return existing confirmation).
 */
export async function runFennLaunchFundPurse(
  deps: FennLaunchFundDeps = {},
): Promise<FennLaunchFundReport> {
  const now = deps.now ?? (() => new Date());
  const notes: string[] = [];

  // --- Durable short-circuit before expensive preflight ---
  const getOperation = deps.getOperation ?? (() => getLaunchOperationById());
  let existing: FennLaunchOperationRow | null;
  try {
    existing = await getOperation();
  } catch (error) {
    return refused(
      "operation_read_failed",
      error instanceof Error ? error.message : "operation_read_failed",
    );
  }

  if (existing?.status === "confirmed") {
    return confirmedReport(existing, "ALREADY_CONFIRMED", [
      "durable operation already confirmed — no broadcast",
    ]);
  }

  if (
    existing &&
    (existing.status === "submitted" || existing.status === "ambiguous")
  ) {
    return reconcileToConfirmed(existing, deps, `status=${existing.status}`);
  }

  if (existing?.status === "failed" && existing.failureClass === "terminal") {
    return refused(
      "terminal_prior_failure",
      "Prior launch funding failed terminally (e.g. revert) — operator intervention required before any new broadcast",
      {
        treasuryAddress: existing.treasuryAddress,
        purseAddress: existing.purseAddress,
        tokenContract: existing.tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        txHash: existing.txHash,
        explorerUrl: existing.txHash
          ? explorerTxUrl(existing.chainId, existing.txHash)
          : null,
        sideEffectsAttempted: true,
        notes: ["second automatic broadcast refused after terminal failure"],
      },
    );
  }

  if (existing?.status === "pending") {
    return refused(
      "pending_already_claimed",
      "A pending launch funding operation already exists — refuse rebroadcast; wait for the other process or investigate the durable row",
      {
        treasuryAddress: existing.treasuryAddress,
        purseAddress: existing.purseAddress,
        tokenContract: existing.tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        sideEffectsAttempted: true,
        notes: [
          "no second broadcast against existing pending; exclusive claim required",
        ],
      },
    );
  }

  // --- Canonical configuration ---
  const getTreasury =
    deps.getTreasuryConfig ?? (() => getTreasuryConfig());
  const getPurse = deps.getPurseConfig ?? (() => getPurseConfig());
  const getOfficial =
    deps.getOfficialToken ?? (() => getOfficialFennTokenAsset());

  let treasuryCfg: TreasuryConfigState;
  let purseCfg: PurseConfigState;
  let token: OfficialFennTokenAsset | null;
  try {
    [treasuryCfg, purseCfg, token] = await Promise.all([
      getTreasury(),
      getPurse(),
      getOfficial(),
    ]);
  } catch (error) {
    return refused(
      "config_load_failed",
      error instanceof Error ? error.message : "config_load_failed",
    );
  }

  if (!treasuryCfg.configured) {
    return refused("treasury_unconfigured", "treasury_config is not configured");
  }
  if (!purseCfg.configured) {
    return refused("purse_unconfigured", "purse_config is not configured");
  }
  if (!token) {
    return refused(
      "official_fenn_unavailable",
      "Official FENN does not resolve — run launch:activate first",
    );
  }

  if (!token.contractAddress) {
    return refused("token_contract_null", "Official contract address is null");
  }
  let tokenContract: string;
  let treasuryAddress: string;
  let purseAddress: string;
  try {
    tokenContract = parseEvmAddress(token.contractAddress);
    treasuryAddress = parseEvmAddress(treasuryCfg.walletAddress);
    purseAddress = parseEvmAddress(purseCfg.walletAddress);
  } catch (error) {
    return refused(
      "malformed_address",
      error instanceof Error ? error.message : "malformed_address",
    );
  }
  if (treasuryAddress === purseAddress) {
    return refused(
      "treasury_purse_same_address",
      "Treasury and Purse addresses must differ",
    );
  }

  if (token.chainId !== FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID) {
    return refused(
      "wrong_chain",
      `Official token chainId ${token.chainId} is not Robinhood (${FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID})`,
    );
  }
  if (token.symbol.trim().toUpperCase() !== "FENN") {
    return refused("symbol_mismatch", `Official symbol is ${token.symbol}`);
  }
  if (token.decimals !== 18) {
    return refused(
      "decimals_not_18",
      `Official DB decimals are ${token.decimals}, expected 18`,
    );
  }

  // --- Signer ---
  let signerAddress: string;
  try {
    const resolve =
      deps.resolveSigner ??
      ((addr: string) =>
        resolveTreasuryLaunchSigningAccount(addr, deps.privateKeyEnv));
    const signed = resolve(treasuryAddress);
    signerAddress = parseEvmAddress(signed.address);
  } catch (error) {
    if (error instanceof LaunchFundSignerError) {
      return refused(error.code, error.message, {
        treasuryAddress,
        purseAddress,
        tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      });
    }
    return refused(
      "treasury_key_invalid",
      error instanceof Error ? error.message : "signer failed",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }
  if (signerAddress !== treasuryAddress) {
    return refused(
      "treasury_key_address_mismatch",
      "Signer address does not match treasury_config",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }

  // --- On-chain verification ---
  let client: RobinhoodPublicClient;
  try {
    client = (deps.createClient ?? (() => createRobinhoodPublicClient()))();
  } catch (error) {
    return refused(
      "rpc_unavailable",
      error instanceof Error ? error.message : "rpc_unavailable",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }

  const getBytecode = deps.getBytecode ?? defaultGetBytecode;
  let bytecode: string | null | undefined;
  try {
    bytecode = await getBytecode(client, tokenContract);
  } catch (error) {
    return refused(
      "bytecode_read_failed",
      error instanceof Error ? error.message : "bytecode_read_failed",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }
  if (bytecode == null || bytecode === "0x" || bytecode.length <= 2) {
    return refused(
      "no_contract_code",
      "Official token address has no deployed bytecode on Robinhood Chain",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }

  const readMeta = deps.readTokenMeta ?? defaultReadTokenMeta;
  let onChainDecimals: number;
  let onChainSymbol: string;
  let onChainName: string | null;
  try {
    const meta = await readMeta(client, tokenContract);
    onChainDecimals = meta.decimals;
    onChainSymbol = meta.symbol;
    onChainName = meta.name;
  } catch (error) {
    return refused(
      "token_meta_read_failed",
      error instanceof Error ? error.message : "token_meta_read_failed",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }
  if (onChainDecimals !== 18) {
    return refused(
      "onchain_decimals_mismatch",
      `On-chain decimals=${onChainDecimals}, expected 18`,
      { treasuryAddress, purseAddress, tokenContract, decimals: onChainDecimals },
    );
  }
  if (onChainSymbol.trim().toUpperCase() !== "FENN") {
    return refused(
      "onchain_symbol_mismatch",
      `On-chain symbol=${onChainSymbol}, expected FENN`,
      { treasuryAddress, purseAddress, tokenContract },
    );
  }
  if (onChainName) {
    notes.push(`onchain_name=${onChainName}`);
  }

  const amountRaw = parseTokenAmountToRaw(
    FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    18,
  );

  const readNative = deps.readNative ?? readNativeBalance;
  const readErc20 = deps.readErc20 ?? readErc20Balance;

  let treasuryEth: TreasuryAmount;
  let treasuryFenn: TreasuryAmount;
  try {
    [treasuryEth, treasuryFenn] = await Promise.all([
      readNative(treasuryAddress, client),
      readErc20({
        tokenAddress: tokenContract,
        holder: treasuryAddress,
        decimals: 18,
        client,
      }),
    ]);
    // Prove balanceOf path for purse as well (informational).
    await readErc20({
      tokenAddress: tokenContract,
      holder: purseAddress,
      decimals: 18,
      client,
    });
  } catch (error) {
    return refused(
      "balance_read_failed",
      error instanceof Error ? error.message : "balance_read_failed",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }

  if (treasuryFenn.raw < amountRaw) {
    return refused(
      "insufficient_treasury_fenn",
      `Treasury FENN ${treasuryFenn.formatted} < ${FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED}`,
      {
        treasuryAddress,
        purseAddress,
        tokenContract,
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        decimals: 18,
      },
    );
  }

  let gasCost: bigint;
  try {
    const estimate =
      deps.estimateGasCostWei ?? defaultEstimateGasCostWei;
    gasCost = await estimate({
      client,
      tokenAddress: tokenContract,
      treasuryAddress,
      purseAddress,
      amountRaw,
    });
  } catch (error) {
    return refused(
      "gas_estimate_failed",
      error instanceof Error ? error.message : "gas_estimate_failed",
      { treasuryAddress, purseAddress, tokenContract },
    );
  }
  if (treasuryEth.raw < gasCost) {
    return refused(
      "insufficient_treasury_eth",
      `Treasury ETH insufficient for estimated gas (need wei ≈ ${gasCost.toString()})`,
      { treasuryAddress, purseAddress, tokenContract },
    );
  }

  // --- Claim / create durable pending ---
  // Pre-existing `pending` is refused earlier (exclusive claim). Only:
  // - reset of pre_broadcast failure, or
  // - new insert of the fixed operation_id
  // may proceed to broadcast.
  let row: FennLaunchOperationRow;
  if (
    existing?.status === "failed" &&
    existing.failureClass === "pre_broadcast"
  ) {
    try {
      const reset = deps.resetForRetry ?? resetLaunchOperationForRetry;
      row = await reset(existing.id);
      notes.push("reset pre_broadcast failure for retry");
    } catch (error) {
      return refused(
        "reset_failed",
        error instanceof Error ? error.message : "reset_failed",
        { sideEffectsAttempted: true },
      );
    }
  } else {
    const insert =
      deps.insertPending ??
      ((input) => insertPendingLaunchOperation(input));
    try {
      const { created, row: inserted } = await insert({
        chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        tokenContract,
        treasuryAddress,
        purseAddress,
        amountRaw: amountRaw.toString(),
        decimals: 18,
      });
      row = inserted;
      if (!created) {
        // Lost race — never broadcast from the non-owner; reconcile only.
        if (row.status === "confirmed") {
          return confirmedReport(row, "ALREADY_CONFIRMED", [
            "concurrent claim lost; operation already confirmed",
          ]);
        }
        if (row.status === "submitted" || row.status === "ambiguous") {
          return reconcileToConfirmed(
            row,
            deps,
            "concurrent claim lost; reconciling",
          );
        }
        if (row.status === "failed" && row.failureClass === "terminal") {
          return refused(
            "terminal_prior_failure",
            "Concurrent process left terminal failure",
            { sideEffectsAttempted: true, txHash: row.txHash },
          );
        }
        if (row.status === "pending") {
          return refused(
            "pending_already_claimed",
            "Concurrent claim lost — another process owns the pending ceremony",
            {
              treasuryAddress,
              purseAddress,
              tokenContract,
              chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
              sideEffectsAttempted: true,
            },
          );
        }
        return refused(
          "claim_lost",
          `Could not exclusively claim launch op; status=${row.status}`,
          { sideEffectsAttempted: true },
        );
      }
    } catch (error) {
      return refused(
        "claim_failed",
        error instanceof Error ? error.message : "claim_failed",
      );
    }
  }

  if (row.status !== "pending") {
    return refused(
      "operation_not_pending",
      `Expected pending ceremony; status=${row.status}`,
      {
        sideEffectsAttempted: true,
        treasuryAddress,
        purseAddress,
        tokenContract,
      },
    );
  }

  // --- Broadcast ---
  const broadcast =
    deps.broadcast ??
    ((input) =>
      broadcastTreasuryErc20Transfer({
        ...input,
        privateKeyEnv: deps.privateKeyEnv,
      }));

  const broadcastResult = await broadcast({
    treasuryAddress,
    tokenAddress: tokenContract,
    recipientAddress: purseAddress,
    amountRaw,
  });

  if (broadcastResult.kind === "pre_broadcast_failed") {
    const markFailed = deps.markFailed ?? markLaunchOperationFailed;
    await markFailed({
      id: row.id,
      failureClass: "pre_broadcast",
      lastError: broadcastResult.error,
      status: "failed",
    });
    return {
      mode: "FENN_LAUNCH_FUND_PURSE",
      status: "FAILED",
      errorCode: "pre_broadcast_failed",
      errorMessage: broadcastResult.error,
      operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
      amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
      amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
      decimals: 18,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      tokenContract,
      treasuryAddress,
      purseAddress,
      txHash: null,
      blockNumber: null,
      explorerUrl: null,
      confirmedAt: null,
      chainBroadcastAttempted: true,
      sideEffectsAttempted: true,
      notes,
    };
  }

  if (broadcastResult.kind === "ambiguous") {
    const markFailed = deps.markFailed ?? markLaunchOperationFailed;
    const submittedAt = now().toISOString();
    if (broadcastResult.txHash) {
      const markSubmitted = deps.markSubmitted ?? markLaunchOperationSubmitted;
      try {
        await markSubmitted({
          id: row.id,
          txHash: broadcastResult.txHash,
          submittedAt,
        });
      } catch {
        // fall through to ambiguous mark
      }
    }
    await markFailed({
      id: row.id,
      failureClass: "ambiguous",
      lastError: broadcastResult.error,
      status: "ambiguous",
      txHash: broadcastResult.txHash ?? null,
    });
    return {
      mode: "FENN_LAUNCH_FUND_PURSE",
      status: "AMBIGUOUS",
      errorCode: "broadcast_ambiguous",
      errorMessage: broadcastResult.error,
      operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
      amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
      amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
      decimals: 18,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      tokenContract,
      treasuryAddress,
      purseAddress,
      txHash: broadcastResult.txHash ?? null,
      blockNumber: null,
      explorerUrl: broadcastResult.txHash
        ? explorerTxUrl(FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID, broadcastResult.txHash)
        : null,
      confirmedAt: null,
      chainBroadcastAttempted: true,
      sideEffectsAttempted: true,
      notes: [
        ...notes,
        "DO NOT rebroadcast — reconcile with launch:fund-purse after chain visibility",
      ],
    };
  }

  // submitted hash — persist immediately
  const submittedAt = now().toISOString();
  const markSubmitted = deps.markSubmitted ?? markLaunchOperationSubmitted;
  try {
    row = await markSubmitted({
      id: row.id,
      txHash: broadcastResult.txHash,
      submittedAt,
    });
  } catch (error) {
    return {
      mode: "FENN_LAUNCH_FUND_PURSE",
      status: "AMBIGUOUS",
      errorCode: "submit_persist_failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : "tx submitted but status persistence failed",
      operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
      amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
      amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
      decimals: 18,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      tokenContract,
      treasuryAddress,
      purseAddress,
      txHash: broadcastResult.txHash,
      blockNumber: null,
      explorerUrl: explorerTxUrl(
        FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        broadcastResult.txHash,
      ),
      confirmedAt: null,
      chainBroadcastAttempted: true,
      sideEffectsAttempted: true,
      notes: [
        ...notes,
        "PRESERVE TX HASH — re-run reconciles; never rebroadcast",
      ],
    };
  }

  // --- Wait receipt ---
  const waitReceipt =
    deps.waitReceipt ??
    (async (hash: string) => {
      const r = await waitForLaunchTransactionReceipt(hash);
      if (r.kind === "success") {
        return {
          kind: "success" as const,
          blockNumber: r.receipt.blockNumber,
        };
      }
      if (r.kind === "reverted") {
        return {
          kind: "reverted" as const,
          blockNumber: r.receipt.blockNumber,
        };
      }
      return r;
    });

  const receipt = await waitReceipt(broadcastResult.txHash);

  if (receipt.kind === "success") {
    const confirmedAt = now().toISOString();
    const markConfirmed = deps.markConfirmed ?? markLaunchOperationConfirmed;
    const confirmed = await markConfirmed({
      id: row.id,
      txHash: broadcastResult.txHash,
      confirmedAt,
      blockNumber:
        receipt.blockNumber != null ? String(receipt.blockNumber) : null,
      submittedAt,
    });
    return confirmedReport(confirmed, "CONFIRMED", notes, true, true);
  }

  if (receipt.kind === "reverted") {
    const markFailed = deps.markFailed ?? markLaunchOperationFailed;
    await markFailed({
      id: row.id,
      failureClass: "terminal",
      lastError: "transaction_reverted",
      status: "failed",
      txHash: broadcastResult.txHash,
    });
    return {
      mode: "FENN_LAUNCH_FUND_PURSE",
      status: "FAILED",
      errorCode: "transaction_reverted",
      errorMessage: "Transaction reverted on chain",
      operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
      amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
      amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
      decimals: 18,
      chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      tokenContract,
      treasuryAddress,
      purseAddress,
      txHash: broadcastResult.txHash,
      blockNumber: null,
      explorerUrl: explorerTxUrl(
        FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
        broadcastResult.txHash,
      ),
      confirmedAt: null,
      chainBroadcastAttempted: true,
      sideEffectsAttempted: true,
      notes: [
        ...notes,
        "terminal — do not rebroadcast without operator review",
      ],
    };
  }

  // unknown / timeout → ambiguous
  const markFailed = deps.markFailed ?? markLaunchOperationFailed;
  await markFailed({
    id: row.id,
    failureClass: "ambiguous",
    lastError: receipt.error,
    status: "ambiguous",
    txHash: broadcastResult.txHash,
  });
  return {
    mode: "FENN_LAUNCH_FUND_PURSE",
    status: "AMBIGUOUS",
    errorCode: "receipt_unknown",
    errorMessage: receipt.error,
    operationId: FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
    amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
    decimals: 18,
    chainId: FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
    tokenContract,
    treasuryAddress,
    purseAddress,
    txHash: broadcastResult.txHash,
    blockNumber: null,
    explorerUrl: explorerTxUrl(
      FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
      broadcastResult.txHash,
    ),
    confirmedAt: null,
    chainBroadcastAttempted: true,
    sideEffectsAttempted: true,
    notes: [
      ...notes,
      "timeout/uncertainty — re-run for reconcile; never rebroadcast",
    ],
  };
}
