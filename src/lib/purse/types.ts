import type {
  PurseActionType,
  PurseFailureClass,
  PurseTransferStatus,
} from "@/lib/purse/constants";

/** Public Purse wallet identity (no notes / keys / actors). */
export type PublicPurseConfig = {
  configured: true;
  walletAddress: string;
  isEnabled: boolean;
  /**
   * When official FENN settlement first activated (UTC ISO).
   * null = never activated. Immutable once set.
   */
  officialSettlementActivatedAt: string | null;
  /**
   * Emergency economic settlement brake (P2A).
   * true = normal; false = executor claims nothing.
   * null = undetermined (fail closed for settlement).
   */
  economicSettlementEnabled: boolean | null;
};

export type PurseConfigState =
  | { configured: false }
  | PublicPurseConfig;

/** Durable settlement row (server-side). */
export type PurseTransferRow = {
  id: string;
  operationId: string;
  recipientAddress: string;
  amountRaw: string;
  amountFormatted: string;
  tokenAddress: string;
  chainId: number;
  txHash: string | null;
  status: PurseTransferStatus;
  failureClass: PurseFailureClass | null;
  lastError: string | null;
  actorId: string | null;
  /** Disposable-token pre-launch settlements only; never public MOVEMENTS. */
  isTest: boolean;
  /**
   * Settlement classification (not native token burn).
   * `burn` = canonical dead-address transfer; still uses ERC-20 transfer().
   */
  actionType: PurseActionType;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
};

/** Public confirmed movement for Commons. */
export type PublicPurseTransfer = {
  id: string;
  operationId: string;
  recipientAddress: string;
  amountFormatted: string;
  tokenAddress: string;
  chainId: number;
  txHash: string;
  confirmedAt: string;
  explorerTxUrl: string | null;
  /** transfer (default) or burn (dead-address send). */
  actionType: PurseActionType;
};

export type PublicPurseFennBalance =
  | {
      state: "available";
      balance: string;
      decimals: number;
      tokenAddress: string;
      symbol: "FENN";
      chainId: number;
    }
  | {
      state: "unavailable";
      reason: "rpc_failed" | "token_unavailable" | "configuration_error";
    };

/**
 * Public Purse snapshot for /commons.
 * Balance from live chain. History is confirmed DB rows only.
 */
export type PublicPurseSnapshot =
  | {
      state: "unconfigured";
    }
  | {
      state: "ready";
      purseAddress: string;
      isEnabled: boolean;
      observedAt: string;
      fennBalance: PublicPurseFennBalance;
      transfers: PublicPurseTransfer[];
    }
  | {
      state: "unavailable";
      purseAddress: string;
      isEnabled: boolean;
      observedAt: string;
      fennBalance: PublicPurseFennBalance;
      transfers: PublicPurseTransfer[];
    };

export type ManualOneFennTransferInput = {
  recipientAddress: string;
  operationId: string;
  actorId?: string;
  /**
   * Trusted decimal string (Stage P1C). Default `"1"` preserves P0 manual CLI.
   * Never derived from untrusted X text at this boundary.
   */
  amountFormatted?: string;
};

export type ManualOneFennTransferResult =
  | {
      ok: true;
      status: "confirmed";
      operationId: string;
      transferId: string;
      recipientAddress: string;
      /** Exact settled amount (decimal string). */
      amountFormatted: string;
      tokenAddress: string;
      chainId: number;
      purseAddress: string;
      txHash: string;
      confirmedAt: string;
      reusedExisting: boolean;
      isTest: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      operationId: string;
      status?: PurseTransferStatus;
      txHash?: string | null;
      failureClass?: PurseFailureClass | null;
    };
