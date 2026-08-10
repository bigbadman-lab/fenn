/**
 * Strictly read-only launch funding preflight / rehearsal.
 *
 * Never broadcasts, never signs, never mutates fenn_launch_operations.
 * Import graph excludes the Treasury write-path module and production fund runner.
 */

import "server-only";

import {
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
  FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
  FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID,
  FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
} from "@/lib/ops/fenn-launch-fund-constants";
import { getLaunchOperationById } from "@/lib/ops/fenn-launch-fund-store";
import {
  FENN_LAUNCH_ERC20_ABI,
  LaunchFundSignerError,
  resolveTreasuryLaunchSigningAccount,
} from "@/lib/ops/fenn-launch-treasury-key";
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
import { parseEvmAddress } from "@/lib/wallet/evm";

export type PreflightVerdict = "PASS" | "FAIL" | "WAITING" | "INFO";

export type PreflightCheck = {
  id: string;
  label: string;
  verdict: PreflightVerdict;
  detail: string | null;
};

export type FennLaunchFundPreflightResult =
  | "READY_TO_FUND"
  | "LOCAL_ENV_READY_WAITING_CONTRACT"
  | "NOT_READY";

export type FennLaunchFundPreflightReport = {
  mode: "FENN_LAUNCH_FUND_PREFLIGHT";
  result: FennLaunchFundPreflightResult;
  resultLabel: string;
  nextStep: string | null;
  broadcastEnabled: false;
  chainBroadcastAttempted: false;
  sideEffectsAttempted: false;
  checks: PreflightCheck[];
  /** True when official FENN CA is live (post-activate). */
  officialTokenPresent: boolean;
  treasuryAddress: string | null;
  purseAddress: string | null;
  tokenContract: string | null;
  amountDisplay: typeof FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY;
  amountFormatted: typeof FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED;
  notes: string[];
  blockingReasons: string[];
};

export type FennLaunchFundPreflightDeps = {
  getTreasuryConfig?: () => Promise<TreasuryConfigState>;
  getPurseConfig?: () => Promise<PurseConfigState>;
  getOfficialToken?: () => Promise<OfficialFennTokenAsset | null>;
  /** Read-only launch op load. Must not insert/update. */
  getOperation?: () => Promise<{
    status: string;
    failureClass?: string | null;
    txHash?: string | null;
  } | null>;
  createClient?: () => RobinhoodPublicClient;
  getChainId?: (
    client: Pick<RobinhoodPublicClient, "getChainId">,
  ) => Promise<number>;
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
    address: string;
  };
  privateKeyEnv?: string;
};

function check(
  id: string,
  label: string,
  verdict: PreflightVerdict,
  detail: string | null = null,
): PreflightCheck {
  return { id, label, verdict, detail };
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

/**
 * Same gas margin as production funding (20% buffer).
 * Uses eth_estimateGas / getGasPrice only — no signing, no nonce, no broadcast.
 */
export async function estimateLaunchFundGasCostWei(input: {
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
  return (gas * gasPrice * BigInt(120)) / BigInt(100);
}

function padLabel(label: string, width = 24): string {
  return label.length >= width ? label : `${label}${" ".repeat(width - label.length)}`;
}

export function formatFennLaunchFundPreflightReport(
  report: FennLaunchFundPreflightReport,
): string {
  const lines: string[] = [
    "FENN LAUNCH FUNDING — PREFLIGHT",
    "",
  ];

  for (const c of report.checks) {
    const detail = c.detail ? ` — ${c.detail}` : "";
    lines.push(`${padLabel(c.label)}${c.verdict}${detail}`);
  }

  lines.push("");
  if (report.officialTokenPresent) {
    lines.push("INTENDED:");
    lines.push(`amount: ${report.amountDisplay} FENN`);
    lines.push(`FROM: ${report.treasuryAddress ?? "null"}`);
    lines.push(`TO: ${report.purseAddress ?? "null"}`);
    lines.push(`TOKEN: ${report.tokenContract ?? "null"}`);
    lines.push(`CHAIN: Robinhood Chain (${FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID})`);
    lines.push("");
  }

  lines.push("BROADCAST ENABLED:       NO");
  lines.push(`sideEffectsAttempted=${report.sideEffectsAttempted}`);
  lines.push(`chainBroadcastAttempted=${report.chainBroadcastAttempted}`);
  lines.push("");
  lines.push(`RESULT: ${report.resultLabel}`);
  if (report.result === "LOCAL_ENV_READY_WAITING_CONTRACT") {
    lines.push("WAITING FOR FENN CONTRACT");
  } else if (report.nextStep) {
    lines.push(`NEXT: ${report.nextStep}`);
  }
  for (const reason of report.blockingReasons) {
    lines.push(`reason=${reason}`);
  }
  for (const n of report.notes) {
    if (n === "WAITING FOR FENN CONTRACT") continue;
    lines.push(`note=${n}`);
  }

  return lines.join("\n");
}

/**
 * Read-only launch funding rehearsal. Never broadcasts or mutates durable rows.
 */
export async function runFennLaunchFundPreflight(
  deps: FennLaunchFundPreflightDeps = {},
): Promise<FennLaunchFundPreflightReport> {
  const checks: PreflightCheck[] = [];
  const notes: string[] = [];
  const blockingReasons: string[] = [];

  let treasuryAddress: string | null = null;
  let purseAddress: string | null = null;
  let tokenContract: string | null = null;
  let officialTokenPresent = false;

  const failCritical = (reason: string) => {
    blockingReasons.push(reason);
  };

  // --- RPC / chain ---
  let client: RobinhoodPublicClient | null = null;
  try {
    client = (deps.createClient ?? (() => createRobinhoodPublicClient()))();
    checks.push(check("rpc", "RPC", "PASS", "Robinhood RPC client constructed"));
  } catch (error) {
    checks.push(
      check(
        "rpc",
        "RPC",
        "FAIL",
        error instanceof Error ? error.message : "rpc_unavailable",
      ),
    );
    failCritical("Robinhood RPC unreachable or unconfigured");
  }

  if (client) {
    try {
      const getChainId =
        deps.getChainId ??
        ((c: Pick<RobinhoodPublicClient, "getChainId">) => c.getChainId());
      const chainId = await getChainId(client);
      if (chainId === FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID) {
        checks.push(
          check(
            "chain",
            "CHAIN",
            "PASS",
            `chain_id=${chainId}`,
          ),
        );
      } else {
        checks.push(
          check(
            "chain",
            "CHAIN",
            "FAIL",
            `chain_id=${chainId} expected ${FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID}`,
          ),
        );
        failCritical(`Wrong chain id ${chainId}`);
      }
    } catch (error) {
      checks.push(
        check(
          "chain",
          "CHAIN",
          "FAIL",
          error instanceof Error ? error.message : "chain_id_read_failed",
        ),
      );
      failCritical("Could not read chain id from RPC");
    }
  } else {
    checks.push(check("chain", "CHAIN", "FAIL", "skipped — no RPC"));
  }

  // --- Configs ---
  let treasuryCfg: TreasuryConfigState;
  let purseCfg: PurseConfigState;
  try {
    const getTreasury =
      deps.getTreasuryConfig ?? (() => getTreasuryConfig());
    const getPurse = deps.getPurseConfig ?? (() => getPurseConfig());
    [treasuryCfg, purseCfg] = await Promise.all([getTreasury(), getPurse()]);
  } catch (error) {
    checks.push(
      check(
        "treasury_config",
        "TREASURY CONFIG",
        "FAIL",
        error instanceof Error ? error.message : "config_load_failed",
      ),
    );
    checks.push(check("purse_config", "PURSE CONFIG", "FAIL", "config_load_failed"));
    failCritical("Could not load treasury/purse config");
    return finalize({
      checks,
      notes,
      blockingReasons,
      officialTokenPresent: false,
      treasuryAddress: null,
      purseAddress: null,
      tokenContract: null,
    });
  }

  if (!treasuryCfg.configured) {
    checks.push(
      check("treasury_config", "TREASURY CONFIG", "FAIL", "not configured"),
    );
    failCritical("treasury_config is not configured");
  } else {
    try {
      treasuryAddress = parseEvmAddress(treasuryCfg.walletAddress);
      checks.push(
        check(
          "treasury_config",
          "TREASURY CONFIG",
          "PASS",
          treasuryAddress,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "treasury_config",
          "TREASURY CONFIG",
          "FAIL",
          error instanceof Error ? error.message : "malformed",
        ),
      );
      failCritical("Treasury address malformed");
    }
  }

  if (!purseCfg.configured) {
    checks.push(check("purse_config", "PURSE CONFIG", "FAIL", "not configured"));
    failCritical("purse_config is not configured");
  } else {
    try {
      purseAddress = parseEvmAddress(purseCfg.walletAddress);
      checks.push(
        check("purse_config", "PURSE CONFIG", "PASS", purseAddress),
      );
    } catch (error) {
      checks.push(
        check(
          "purse_config",
          "PURSE CONFIG",
          "FAIL",
          error instanceof Error ? error.message : "malformed",
        ),
      );
      failCritical("Purse address malformed");
    }
  }

  if (
    treasuryAddress &&
    purseAddress &&
    treasuryAddress === purseAddress
  ) {
    checks.push(
      check(
        "wallets_distinct",
        "WALLETS DISTINCT",
        "FAIL",
        "Treasury and Purse are the same address",
      ),
    );
    failCritical("Treasury and Purse must differ");
  } else if (treasuryAddress && purseAddress) {
    checks.push(check("wallets_distinct", "WALLETS DISTINCT", "PASS"));
  }

  // --- Signer (derive only — never signs a tx) ---
  if (treasuryAddress) {
    try {
      const resolve =
        deps.resolveSigner ??
        ((addr: string) =>
          resolveTreasuryLaunchSigningAccount(addr, deps.privateKeyEnv));
      const { address } = resolve(treasuryAddress);
      const derived = parseEvmAddress(address);
      if (derived !== treasuryAddress) {
        checks.push(
          check(
            "treasury_signer",
            "TREASURY SIGNER",
            "FAIL",
            "derived address does not match treasury_config",
          ),
        );
        failCritical("Treasury signer/address mismatch");
      } else {
        checks.push(
          check(
            "treasury_signer",
            "TREASURY SIGNER",
            "PASS",
            derived,
          ),
        );
      }
    } catch (error) {
      if (error instanceof LaunchFundSignerError) {
        checks.push(
          check(
            "treasury_signer",
            "TREASURY SIGNER",
            "FAIL",
            error.code,
          ),
        );
        failCritical(error.message);
      } else {
        checks.push(
          check(
            "treasury_signer",
            "TREASURY SIGNER",
            "FAIL",
            error instanceof Error ? error.message : "signer_failed",
          ),
        );
        failCritical("Treasury signer failed");
      }
    }
  } else {
    checks.push(
      check(
        "treasury_signer",
        "TREASURY SIGNER",
        "FAIL",
        "skipped — no treasury address",
      ),
    );
  }

  // --- Native balances ---
  const readNative = deps.readNative ?? readNativeBalance;
  let treasuryEth: TreasuryAmount | null = null;
  if (client && treasuryAddress) {
    try {
      treasuryEth = await readNative(treasuryAddress, client);
      checks.push(
        check(
          "treasury_eth",
          "TREASURY ETH",
          "PASS",
          `${treasuryEth.formatted} ETH`,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "treasury_eth",
          "TREASURY ETH",
          "FAIL",
          error instanceof Error ? error.message : "read_failed",
        ),
      );
      failCritical("Could not read Treasury ETH");
    }
  }

  if (client && purseAddress) {
    try {
      const purseEth = await readNative(purseAddress, client);
      checks.push(
        check(
          "purse_eth",
          "PURSE ETH",
          "PASS",
          `${purseEth.formatted} ETH`,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "purse_eth",
          "PURSE ETH",
          "FAIL",
          error instanceof Error ? error.message : "read_failed",
        ),
      );
      // Informational for launch fund (gas paid by Treasury). Still surface.
      notes.push("purse_eth_read_failed");
    }
  }

  // --- Durable operation (read-only) ---
  try {
    const getOperation =
      deps.getOperation ??
      (async () => {
        const row = await getLaunchOperationById(
          FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID,
        );
        if (!row) return null;
        return {
          status: row.status,
          failureClass: row.failureClass,
          txHash: row.txHash,
        };
      });
    const op = await getOperation();
    if (!op) {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "PASS",
          `${FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID}=absent (eligible)`,
        ),
      );
    } else if (op.status === "confirmed") {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "FAIL",
          "already confirmed — never fund again",
        ),
      );
      failCritical("Launch funding already confirmed");
    } else if (op.status === "submitted" || op.status === "ambiguous") {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "FAIL",
          `status=${op.status} — reconcile only; not eligible for new broadcast`,
        ),
      );
      failCritical(`Launch operation is ${op.status}`);
    } else if (op.status === "pending") {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "FAIL",
          "pending claim exists — not exclusively eligible",
        ),
      );
      failCritical("Pending launch operation already claimed");
    } else if (
      op.status === "failed" &&
      op.failureClass === "terminal"
    ) {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "FAIL",
          "terminal failure — operator intervention required",
        ),
      );
      failCritical("Terminal prior launch funding failure");
    } else if (
      op.status === "failed" &&
      op.failureClass === "pre_broadcast"
    ) {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "PASS",
          "pre_broadcast failure — eligible for controlled retry",
        ),
      );
    } else {
      checks.push(
        check(
          "launch_operation",
          "LAUNCH OPERATION",
          "FAIL",
          `status=${op.status}`,
        ),
      );
      failCritical(`Unexpected launch operation status ${op.status}`);
    }
  } catch (error) {
    checks.push(
      check(
        "launch_operation",
        "LAUNCH OPERATION",
        "FAIL",
        error instanceof Error ? error.message : "table_read_failed",
      ),
    );
    failCritical(
      "fenn_launch_operations read failed (migration/permissions?)",
    );
  }

  // --- Official token ---
  let token: OfficialFennTokenAsset | null = null;
  try {
    const getOfficial =
      deps.getOfficialToken ?? (() => getOfficialFennTokenAsset());
    token = await getOfficial();
  } catch (error) {
    checks.push(
      check(
        "official_fenn",
        "OFFICIAL FENN",
        "FAIL",
        error instanceof Error ? error.message : "resolve_failed",
      ),
    );
    failCritical("Official FENN resolver error");
    return finalize({
      checks,
      notes,
      blockingReasons,
      officialTokenPresent: false,
      treasuryAddress,
      purseAddress,
      tokenContract: null,
    });
  }

  if (!token || !token.contractAddress) {
    checks.push(
      check(
        "official_fenn",
        "OFFICIAL FENN",
        "WAITING",
        "token not activated yet",
      ),
    );
    notes.push("OFFICIAL FENN: WAITING — token not activated yet");
    return finalize({
      checks,
      notes,
      blockingReasons,
      officialTokenPresent: false,
      treasuryAddress,
      purseAddress,
      tokenContract: null,
    });
  }

  officialTokenPresent = true;

  // Post-activation identity
  if (token.chainId !== FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID) {
    checks.push(
      check(
        "official_fenn",
        "OFFICIAL FENN",
        "FAIL",
        `chain_id=${token.chainId}`,
      ),
    );
    failCritical("Official token wrong chain");
  } else if (token.symbol.trim().toUpperCase() !== "FENN") {
    checks.push(
      check(
        "official_fenn",
        "OFFICIAL FENN",
        "FAIL",
        `symbol=${token.symbol}`,
      ),
    );
    failCritical("Official token symbol mismatch");
  } else if (token.decimals !== 18) {
    checks.push(
      check(
        "official_fenn",
        "OFFICIAL FENN",
        "FAIL",
        `db_decimals=${token.decimals}`,
      ),
    );
    failCritical("Official DB decimals not 18");
  } else {
    try {
      tokenContract = parseEvmAddress(token.contractAddress);
      checks.push(
        check(
          "official_fenn",
          "OFFICIAL FENN",
          "PASS",
          tokenContract,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "official_fenn",
          "OFFICIAL FENN",
          "FAIL",
          error instanceof Error ? error.message : "malformed_contract",
        ),
      );
      failCritical("Official contract malformed");
      return finalize({
        checks,
        notes,
        blockingReasons,
        officialTokenPresent: true,
        treasuryAddress,
        purseAddress,
        tokenContract: null,
      });
    }
  }

  if (!client || !tokenContract || !treasuryAddress || !purseAddress) {
    return finalize({
      checks,
      notes,
      blockingReasons,
      officialTokenPresent,
      treasuryAddress,
      purseAddress,
      tokenContract,
    });
  }

  // On-chain token verification
  const getBytecode = deps.getBytecode ?? defaultGetBytecode;
  try {
    const bytecode = await getBytecode(client, tokenContract);
    if (bytecode == null || bytecode === "0x" || bytecode.length <= 2) {
      checks.push(
        check(
          "token_bytecode",
          "TOKEN BYTECODE",
          "FAIL",
          "no deployed code",
        ),
      );
      failCritical("Official token has no bytecode");
    } else {
      checks.push(check("token_bytecode", "TOKEN BYTECODE", "PASS"));
    }
  } catch (error) {
    checks.push(
      check(
        "token_bytecode",
        "TOKEN BYTECODE",
        "FAIL",
        error instanceof Error ? error.message : "bytecode_read_failed",
      ),
    );
    failCritical("Bytecode read failed");
  }

  const readMeta = deps.readTokenMeta ?? defaultReadTokenMeta;
  try {
    const meta = await readMeta(client, tokenContract);
    if (meta.decimals === 18) {
      checks.push(
        check("token_decimals", "TOKEN DECIMALS", "PASS", "18"),
      );
    } else {
      checks.push(
        check(
          "token_decimals",
          "TOKEN DECIMALS",
          "FAIL",
          `on-chain=${meta.decimals}`,
        ),
      );
      failCritical("On-chain decimals are not 18");
    }
    if (meta.symbol.trim().toUpperCase() === "FENN") {
      checks.push(
        check("token_symbol", "TOKEN SYMBOL", "PASS", meta.symbol),
      );
    } else {
      checks.push(
        check(
          "token_symbol",
          "TOKEN SYMBOL",
          "FAIL",
          meta.symbol,
        ),
      );
      failCritical(`On-chain symbol ${meta.symbol} is not FENN`);
    }
    if (meta.name) {
      checks.push(
        check("token_name", "TOKEN NAME", "INFO", meta.name),
      );
    }
  } catch (error) {
    checks.push(
      check(
        "token_symbol",
        "TOKEN SYMBOL",
        "FAIL",
        error instanceof Error ? error.message : "meta_failed",
      ),
    );
    checks.push(
      check("token_decimals", "TOKEN DECIMALS", "FAIL", "meta_failed"),
    );
    failCritical("Token meta read failed");
  }

  const amountRaw = parseTokenAmountToRaw(
    FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    18,
  );
  const readErc20 = deps.readErc20 ?? readErc20Balance;

  try {
    const treasuryFenn = await readErc20({
      tokenAddress: tokenContract,
      holder: treasuryAddress,
      decimals: 18,
      client,
    });
    if (treasuryFenn.raw >= amountRaw) {
      checks.push(
        check(
          "treasury_fenn",
          "TREASURY FENN",
          "PASS",
          `${treasuryFenn.formatted} FENN (≥ ${FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED})`,
        ),
      );
    } else {
      checks.push(
        check(
          "treasury_fenn",
          "TREASURY FENN",
          "FAIL",
          `${treasuryFenn.formatted} FENN < ${FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED}`,
        ),
      );
      failCritical("Treasury FENN insufficient for 10,000,000 transfer");
    }
  } catch (error) {
    checks.push(
      check(
        "treasury_fenn",
        "TREASURY FENN",
        "FAIL",
        error instanceof Error ? error.message : "balanceOf_failed",
      ),
    );
    failCritical("Treasury FENN balanceOf failed");
  }

  try {
    const purseFenn = await readErc20({
      tokenAddress: tokenContract,
      holder: purseAddress,
      decimals: 18,
      client,
    });
    checks.push(
      check(
        "purse_fenn",
        "PURSE FENN",
        "PASS",
        `${purseFenn.formatted} FENN (informational)`,
      ),
    );
  } catch (error) {
    checks.push(
      check(
        "purse_fenn",
        "PURSE FENN",
        "FAIL",
        error instanceof Error ? error.message : "balanceOf_failed",
      ),
    );
    notes.push("purse_fenn_read_failed");
  }

  // Gas estimate (no sign / no nonce / no broadcast)
  try {
    const estimate =
      deps.estimateGasCostWei ?? estimateLaunchFundGasCostWei;
    const gasCost = await estimate({
      client,
      tokenAddress: tokenContract,
      treasuryAddress,
      purseAddress,
      amountRaw,
    });
    if (treasuryEth && treasuryEth.raw >= gasCost) {
      checks.push(
        check(
          "gas",
          "GAS",
          "PASS",
          `estimated_wei=${gasCost.toString()} (incl. 20% buffer)`,
        ),
      );
    } else if (treasuryEth) {
      checks.push(
        check(
          "gas",
          "GAS",
          "FAIL",
          `Treasury ETH insufficient for estimated gas ~ ${gasCost.toString()} wei`,
        ),
      );
      failCritical("Insufficient Treasury ETH for estimated fund gas");
    } else {
      checks.push(
        check(
          "gas",
          "GAS",
          "FAIL",
          "cannot compare — treasury ETH unread",
        ),
      );
      failCritical("Gas estimate present but Treasury ETH unknown");
    }
  } catch (error) {
    checks.push(
      check(
        "gas",
        "GAS",
        "FAIL",
        error instanceof Error ? error.message : "estimate_failed",
      ),
    );
    failCritical("Gas estimate failed");
  }

  return finalize({
    checks,
    notes,
    blockingReasons,
    officialTokenPresent,
    treasuryAddress,
    purseAddress,
    tokenContract,
  });
}

function finalize(input: {
  checks: PreflightCheck[];
  notes: string[];
  blockingReasons: string[];
  officialTokenPresent: boolean;
  treasuryAddress: string | null;
  purseAddress: string | null;
  tokenContract: string | null;
}): FennLaunchFundPreflightReport {
  const hasFail = input.blockingReasons.length > 0;
  let result: FennLaunchFundPreflightResult;
  let resultLabel: string;
  let nextStep: string | null = null;

  if (hasFail) {
    result = "NOT_READY";
    resultLabel = "NOT READY";
  } else if (!input.officialTokenPresent) {
    result = "LOCAL_ENV_READY_WAITING_CONTRACT";
    resultLabel = "LOCAL LAUNCH ENVIRONMENT READY";
    nextStep = "WAITING FOR FENN CONTRACT";
  } else {
    result = "READY_TO_FUND";
    resultLabel = "READY TO FUND";
    nextStep = "npm run launch:fund-purse";
  }

  return {
    mode: "FENN_LAUNCH_FUND_PREFLIGHT",
    result,
    resultLabel,
    nextStep,
    broadcastEnabled: false,
    chainBroadcastAttempted: false,
    sideEffectsAttempted: false,
    checks: input.checks,
    officialTokenPresent: input.officialTokenPresent,
    treasuryAddress: input.treasuryAddress,
    purseAddress: input.purseAddress,
    tokenContract: input.tokenContract,
    amountDisplay: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY,
    amountFormatted: FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED,
    notes: input.notes,
    blockingReasons: input.blockingReasons,
  };
}
