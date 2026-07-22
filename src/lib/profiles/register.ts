import "server-only";

import { z } from "zod";

import {
  assertWalletOwnedByIdentity,
  AuthError,
  type VerifiedPrivyIdentity,
} from "@/lib/auth/get-verified-privy-user";
import { CONTRIBUTION_TYPES } from "@/lib/profiles/constants";
import { profileDto } from "@/lib/profiles/queries";
import type { SafeApplicationSummary, SafeProfile } from "@/lib/profiles/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseEvmAddress } from "@/lib/wallet/evm";

export { CONTRIBUTION_TYPES } from "@/lib/profiles/constants";

export const outlawRegisterSchema = z.object({
  chosenName: z
    .string()
    .trim()
    .min(2, "chosenName too short")
    .max(48, "chosenName too long"),
  xHandle: z
    .string()
    .trim()
    .max(32, "xHandle too long")
    .optional()
    .nullable(),
  whyStatement: z
    .string()
    .trim()
    .min(8, "whyStatement too short")
    .max(2000, "whyStatement too long"),
  contributionType: z.enum(CONTRIBUTION_TYPES),
  vowAccepted: z.literal(true),
  termsVersion: z
    .string()
    .trim()
    .min(1, "termsVersion required")
    .max(64, "termsVersion too long"),
  walletAddress: z.string().trim().min(1, "walletAddress required"),
});

export type OutlawRegisterInput = z.infer<typeof outlawRegisterSchema>;

export class RegisterError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "RegisterError";
    this.status = status;
    this.code = code;
  }
}

function normalizeXHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) {
    throw new RegisterError("Invalid X handle", 400, "invalid_x_handle");
  }
  return trimmed;
}

export type RegisterResult = {
  profile: SafeProfile;
  application: SafeApplicationSummary;
  created: boolean;
};

type RegisterOutlawRow = {
  created: boolean;
  profile_id: string;
  outlaw_number: number;
  alias: string | null;
  wallet_address: string;
  privy_user_id: string | null;
  joined_at: string;
  leaf_balance: number;
  leaf_lifetime_earned: number;
  deeds_completed_count: number;
  greenwood_entered_at: string | null;
  application_id: string;
  review_status: string;
  submitted_at: string;
};

function mapRpcConflict(message: string): RegisterError | null {
  if (message.includes("FENN_VALIDATION:")) {
    return new RegisterError(
      "Invalid registration payload",
      400,
      "validation_error",
    );
  }

  if (message.includes("FENN_CONFLICT:")) {
    if (message.includes("different wallet")) {
      return new RegisterError(
        "This Privy identity is already anchored to a different wallet",
        409,
        "privy_wallet_conflict",
      );
    }
    if (message.includes("another Privy identity")) {
      return new RegisterError(
        "This wallet is already linked to another Privy identity",
        409,
        "wallet_privy_conflict",
      );
    }
    return new RegisterError(
      "Identity conflict during registration",
      409,
      "identity_conflict",
    );
  }

  if (message.includes("duplicate key") || message.includes("unique constraint")) {
    return new RegisterError(
      "Identity conflict during registration",
      409,
      "unique_violation",
    );
  }

  return null;
}

/**
 * Atomic Outlaw registration via public.register_outlaw RPC.
 * Privy verification and wallet ownership checks happen before this call.
 */
export async function registerOutlaw(
  identity: VerifiedPrivyIdentity,
  rawInput: unknown,
): Promise<RegisterResult> {
  const parsed = outlawRegisterSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new RegisterError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
      400,
      "validation_error",
    );
  }

  const input = parsed.data;

  let walletAddress: string;
  try {
    walletAddress = assertWalletOwnedByIdentity(identity, input.walletAddress);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new RegisterError(error.message, error.status, "wallet_not_owned");
    }
    throw error;
  }

  parseEvmAddress(walletAddress);
  const xHandle = normalizeXHandle(input.xHandle);
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("register_outlaw", {
    p_privy_user_id: identity.privyUserId,
    p_wallet_address: walletAddress,
    p_chosen_name: input.chosenName,
    p_x_handle: xHandle,
    p_why_statement: input.whyStatement,
    p_contribution_type: input.contributionType,
    p_vow_accepted: true,
    p_terms_version: input.termsVersion,
    p_raw_answers: {
      contributionType: input.contributionType,
      termsVersion: input.termsVersion,
    },
  });

  if (error) {
    const mapped = mapRpcConflict(error.message);
    if (mapped) throw mapped;

    console.error("[register_outlaw rpc]", error);
    throw new RegisterError(
      "Registration failed",
      500,
      "registration_failed",
    );
  }

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as RegisterOutlawRow[];
  const row = rows[0];

  if (!row) {
    throw new RegisterError(
      "Registration returned no row",
      500,
      "registration_empty",
    );
  }

  const profile = profileDto({
    id: row.profile_id,
    outlaw_number: row.outlaw_number,
    alias: row.alias,
    wallet_address: row.wallet_address,
    joined_at: row.joined_at,
    leaf_balance: row.leaf_balance,
    leaf_lifetime_earned: row.leaf_lifetime_earned,
    deeds_completed_count: row.deeds_completed_count,
    greenwood_entered_at: row.greenwood_entered_at,
    privy_user_id: row.privy_user_id,
  });

  const application: SafeApplicationSummary = {
    status: row.review_status,
    submittedAt: row.submitted_at,
  };

  return {
    profile,
    application,
    created: Boolean(row.created),
  };
}
