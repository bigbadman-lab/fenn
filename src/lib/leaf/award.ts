import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { LeafError } from "@/lib/leaf/errors";
import type { AwardLeafInput, LeafMutationResult } from "@/lib/leaf/types";
import {
  assertIdempotencyKey,
  assertMetadata,
  assertOptionalActorId,
  assertOptionalSourceId,
  assertPositiveAwardAmount,
  assertProfileId,
  assertReason,
} from "@/lib/leaf/validate";
import { requireProfileWallet, writeLeafEntry } from "@/lib/leaf/write";

const AWARD_SOURCE_TYPES = new Set(["camp", "deed", "system"]);
const AWARD_ACTOR_TYPES = new Set(["system", "service"]);

/**
 * Authoritative positive LEAF award. lifetime_delta is always equal to amount.
 * Callers must supply a stable business idempotency key.
 */
export async function awardLeaf(
  input: AwardLeafInput,
): Promise<LeafMutationResult> {
  const profileId = assertProfileId(input.profileId);
  const amount = assertPositiveAwardAmount(input.amount);
  const reason = assertReason(input.reason);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const metadata = assertMetadata(input.metadata);
  const sourceId = assertOptionalSourceId(input.sourceId);
  const secondarySourceId = assertOptionalSourceId(input.secondarySourceId);
  const actorId = assertOptionalActorId(input.actorId);

  if (!AWARD_SOURCE_TYPES.has(input.sourceType)) {
    throw new LeafError(
      "INVALID_SOURCE_TYPE",
      "sourceType must be camp, deed, or system",
    );
  }
  if (!AWARD_ACTOR_TYPES.has(input.actorType)) {
    throw new LeafError(
      "INVALID_ACTOR",
      "actorType must be system or service for awards",
    );
  }

  // Reject accidental lifetime_delta on award payloads (TS prevents it; runtime guard).
  if (
    "lifetimeDelta" in (input as object) ||
    "lifetime_delta" in (input as object)
  ) {
    throw new LeafError(
      "INVALID_LIFETIME_DELTA",
      "lifetimeDelta cannot be supplied to awardLeaf",
    );
  }

  const admin = createAdminClient();
  const profile = await requireProfileWallet(admin, profileId);

  return writeLeafEntry(admin, {
    profileId: profile.id,
    walletAddress: profile.walletAddress,
    amount,
    lifetimeDelta: amount,
    sourceType: input.sourceType,
    sourceId,
    secondarySourceId,
    reason,
    actorType: input.actorType,
    actorId,
    idempotencyKey,
    metadata,
  });
}
