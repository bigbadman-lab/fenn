export type PurseErrorCode =
  | "purse_unconfigured"
  | "purse_disabled"
  | "purse_config_failed"
  | "purse_invalid_address"
  | "purse_invalid_recipient"
  | "purse_invalid_operation_id"
  | "purse_key_missing"
  | "purse_key_invalid"
  | "purse_key_address_mismatch"
  | "purse_official_token_unavailable"
  | "purse_wrong_chain"
  | "purse_amount_not_fixed"
  | "purse_invalid_amount"
  | "purse_native_transfer_forbidden"
  | "purse_arbitrary_token_forbidden"
  | "purse_insufficient_fenn"
  | "purse_rpc_unavailable"
  | "purse_lock_busy"
  | "purse_settlement_failed"
  | "purse_ambiguous"
  | "purse_terminal_failed"
  | "purse_broadcast_failed"
  | "purse_read_failed"
  | "purse_test_mode_inactive"
  | "purse_test_mode_production_forbidden"
  | "purse_test_mode_official_fenn_exists"
  | "purse_test_token_unavailable"
  | "purse_insufficient_test_token";

export class PurseError extends Error {
  code: PurseErrorCode;
  status: number;

  constructor(code: PurseErrorCode, message: string, status = 500) {
    super(message);
    this.name = "PurseError";
    this.code = code;
    this.status = status;
  }
}
