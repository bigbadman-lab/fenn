import "server-only";

import { X_OAUTH_CREDENTIAL_SLOT } from "@/lib/agent/execute-config";
import { createAdminClient } from "@/lib/supabase/admin";

export type DeskAgentStatusCounts = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type DeskAgentRecentAction = {
  kind: "effect";
  status: string;
  effectType: string;
  externalResultId: string | null;
  updatedAt: string | null;
};

export type DeskAgentHealth = {
  identity: {
    configuredUsername: string | null;
    userIdConfigured: boolean;
    oauthBound: boolean;
    oauthUsername: string | null;
    oauthExpiresAt: string | null;
    oauthUpdatedAt: string | null;
    tokenExpiryState: "unknown" | "valid" | "expired" | "missing_expiry";
  };
  perception: DeskAgentStatusCounts & {
    lastPollAt: string | null;
    cursorPresent: boolean;
  };
  judgement: DeskAgentStatusCounts;
  authority: {
    authorised: number;
    denied: number;
    noAction: number;
  };
  effects: DeskAgentStatusCounts & {
    latestExternalResultId: string | null;
  };
  warnings: string[];
  recentActions: DeskAgentRecentAction[];
  backlog: boolean;
  serverNow: string;
};

async function countEq(
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const db = createAdminClient();
  const { count, error } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function statusCounts(
  table: string,
  statuses: Array<keyof DeskAgentStatusCounts>,
): Promise<DeskAgentStatusCounts> {
  const pairs = await Promise.all(
    statuses.map(async (status) => [status, await countEq(table, "status", status)] as const),
  );
  const out: DeskAgentStatusCounts = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };
  for (const [status, n] of pairs) out[status] = n;
  return out;
}

export async function getDeskAgentHealth(): Promise<DeskAgentHealth> {
  const db = createAdminClient();
  const now = new Date();
  const warnings: string[] = [];

  const configuredUsername =
    process.env.FENN_X_USERNAME?.trim().replace(/^@/, "") || "askfenn";
  const userIdConfigured = Boolean(process.env.FENN_X_USER_ID?.trim());

  const { data: oauthRow, error: oauthError } = await db
    .from("x_oauth_credentials")
    .select("x_username, expires_at, updated_at")
    .eq("slot", X_OAUTH_CREDENTIAL_SLOT)
    .maybeSingle();
  if (oauthError) throw new Error(oauthError.message);

  const oauthBound = Boolean(oauthRow);
  if (!oauthBound) warnings.push("OAuth is not bound.");

  let tokenExpiryState: DeskAgentHealth["identity"]["tokenExpiryState"] =
    "unknown";
  const expiresAt =
    typeof oauthRow?.expires_at === "string" ? oauthRow.expires_at : null;
  if (!oauthBound) tokenExpiryState = "unknown";
  else if (!expiresAt) tokenExpiryState = "missing_expiry";
  else if (new Date(expiresAt).getTime() <= now.getTime()) {
    tokenExpiryState = "expired";
    warnings.push("OAuth token appears expired.");
  } else tokenExpiryState = "valid";

  const { data: pollRow } = await db
    .from("x_poll_state")
    .select("since_id, updated_at")
    .eq("key", "mentions_askfenn")
    .maybeSingle();

  const lastPollAt =
    typeof pollRow?.updated_at === "string" ? pollRow.updated_at : null;
  const cursorPresent = Boolean(
    typeof pollRow?.since_id === "string" && pollRow.since_id.length > 0,
  );
  if (!lastPollAt) {
    warnings.push(
      "No poll cursor update is recorded (inference — runtime may still be active).",
    );
  }

  const [perceptionPending, perceptionProcessing, perceptionProcessed, perceptionFailed] =
    await Promise.all([
      countEq("x_perception_events", "status", "pending"),
      countEq("x_perception_events", "status", "processing"),
      countEq("x_perception_events", "status", "processed"),
      countEq("x_perception_events", "status", "failed"),
    ]);

  const perception: DeskAgentHealth["perception"] = {
    pending: perceptionPending,
    processing: perceptionProcessing,
    completed: perceptionProcessed,
    failed: perceptionFailed,
    lastPollAt,
    cursorPresent,
  };

  // Judgement rows are final intentions (no status column). Pending work lives on perceptions.
  const { count: judgementCompleted, error: judgementError } = await db
    .from("x_perception_judgements")
    .select("id", { count: "exact", head: true });
  if (judgementError) throw new Error(judgementError.message);

  const judgement: DeskAgentStatusCounts = {
    pending: perceptionPending,
    processing: perceptionProcessing,
    completed: judgementCompleted ?? 0,
    failed: perceptionFailed,
  };

  const [authorised, denied, noAction, effects] = await Promise.all([
    countEq("x_perception_authorizations", "outcome", "permitted"),
    countEq("x_perception_authorizations", "outcome", "denied"),
    countEq("x_perception_authorizations", "outcome", "no_action"),
    statusCounts("x_perception_effects", [
      "pending",
      "processing",
      "completed",
      "failed",
    ]),
  ]);

  if (perception.processing > 0) {
    warnings.push("Perceptions appear stuck in processing.");
  }
  if (effects.processing > 0) {
    warnings.push("Effects appear stuck in processing.");
  }
  if (effects.failed > 0) {
    warnings.push("Failed effects need attention outside The Desk.");
  }

  const backlog =
    perception.pending + judgement.pending + effects.pending > 25;
  if (backlog) {
    warnings.push("Pipeline backlog is above a conservative threshold.");
  }
  if (!userIdConfigured) {
    warnings.push("Configured X user ID is missing.");
  }

  const { data: recentEffects } = await db
    .from("x_perception_effects")
    .select("status, effect_type, external_result_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(8);

  const recentActions: DeskAgentRecentAction[] = (recentEffects ?? []).map(
    (row) => {
      const r = row as {
        status: string;
        effect_type: string;
        external_result_id: string | null;
        updated_at: string | null;
      };
      return {
        kind: "effect",
        status: r.status,
        effectType: r.effect_type,
        externalResultId: r.external_result_id,
        updatedAt: r.updated_at,
      };
    },
  );

  return {
    identity: {
      configuredUsername,
      userIdConfigured,
      oauthBound,
      oauthUsername:
        typeof oauthRow?.x_username === "string" ? oauthRow.x_username : null,
      oauthExpiresAt: expiresAt,
      oauthUpdatedAt:
        typeof oauthRow?.updated_at === "string" ? oauthRow.updated_at : null,
      tokenExpiryState,
    },
    perception,
    judgement,
    authority: { authorised, denied, noAction },
    effects: {
      ...effects,
      latestExternalResultId:
        recentActions.find((a) => a.externalResultId)?.externalResultId ?? null,
    },
    warnings,
    recentActions,
    backlog,
    serverNow: now.toISOString(),
  };
}
