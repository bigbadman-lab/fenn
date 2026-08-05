/**
 * Safe structured logs for Clearing ops. Never log secrets, cookies, bodies, or raw IPs.
 */

export type ClearingLogEvent =
  | "traveller_mint"
  | "traveller_mint_fail"
  | "message_accepted"
  | "message_rejected"
  | "registration_required"
  | "rate_limited"
  | "read_only_block"
  | "voice_block"
  | "moderation_action"
  | "feed_fail"
  | "rpc_fail"
  | "config_fail";

export type ClearingLogFields = {
  event: ClearingLogEvent;
  ok?: boolean;
  code?: string;
  authorType?: string;
  reused?: boolean;
  action?: string;
  messageId?: string;
  /** Opaque truncated hash prefix only — never full network key. */
  networkHashPrefix?: string;
  detail?: string;
};

function safeLogDetail(value: string | undefined, max = 120): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]+/g, " ").slice(0, max);
}

/**
 * Write one structured log line to stdout/stderr.
 * Values must already be scrubbed by the caller.
 */
export function logClearing(fields: ClearingLogFields): void {
  const line = {
    domain: "clearing",
    ts: new Date().toISOString(),
    event: fields.event,
    ok: fields.ok,
    code: fields.code,
    authorType: fields.authorType,
    reused: fields.reused,
    action: fields.action,
    messageId: fields.messageId,
    networkHashPrefix: fields.networkHashPrefix?.slice(0, 8),
    detail: safeLogDetail(fields.detail),
  };
  // Prefer console so Vercel platform logs capture them.
  if (fields.ok === false) {
    console.error(JSON.stringify(line));
  } else {
    console.info(JSON.stringify(line));
  }
}
