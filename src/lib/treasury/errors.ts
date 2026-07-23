export type TreasuryErrorCode =
  | "treasury_unconfigured"
  | "treasury_rpc_unavailable"
  | "treasury_invalid_address"
  | "treasury_asset_chain_mismatch"
  | "treasury_invalid_token_address"
  | "treasury_read_failed"
  | "treasury_config_failed";

export class TreasuryError extends Error {
  code: TreasuryErrorCode;
  status: number;

  constructor(code: TreasuryErrorCode, message: string, status = 500) {
    super(message);
    this.name = "TreasuryError";
    this.code = code;
    this.status = status;
  }
}
