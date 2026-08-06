/**
 * Stage 2 — fail-closed public fact readers for the X agent.
 *
 * Count definitions (schema: public.profiles):
 *
 * confirmed_outlaw_count:
 *   Count of active registered Outlaw rows in `profiles` where is_active = true.
 *   A profiles row is created only by successful Outlaw registration (atomic
 *   register_outlaw path). Incomplete / guest / rejected applications are not
 *   profiles. Soft-inactive rows (is_active = false) are excluded.
 *
 * greenwood_member_count:
 *   Count of active profiles with greenwood_entered_at IS NOT NULL
 *   (canonical membership field — not LEAF balance inference).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { getConfiguredGreenwoodLifetimeThreshold } from "@/lib/leaf/standing";
import { getPublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal";
import { listPublicChronicleEntries } from "@/lib/chronicle/read";
import { getPublicOfficialFennToken } from "@/lib/treasury/official-token";
import { assertSafeIntegerAmount } from "@/lib/leaf/validate";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function nowIso(): string {
  return new Date().toISOString();
}

function unavailable(
  key: PublicFactEvidence["key"],
  source: string,
  privacy: PublicFactEvidence["privacy"],
): PublicFactEvidence {
  return {
    key,
    available: false,
    value: null,
    detail: null,
    observedAt: nowIso(),
    source,
    privacy,
  };
}

async function headCountActiveProfiles(
  admin: SupabaseClient,
  options?: { greenwoodMembersOnly?: boolean },
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (options?.greenwoodMembersOnly) {
    q = q.not("greenwood_entered_at", "is", null);
  }
  const { count, error } = await q;
  if (error || count == null) return null;
  try {
    const n = assertSafeIntegerAmount(count, "profile_count", "UNSAFE_BIGINT");
    return n < 0 ? null : n;
  } catch {
    return null;
  }
}

/**
 * Confirmed Outlaw count: active profiles (registered Outlaws only).
 * Service-role head count; fail closed.
 */
export async function readConfirmedOutlawCount(options?: {
  admin?: SupabaseClient;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.confirmed_outlaw_count";
  const observedAt = options?.now?.() ?? nowIso();
  try {
    const admin = options?.admin ?? (await defaultAdmin());
    const n = await headCountActiveProfiles(admin);
    if (n == null) {
      return unavailable("confirmed_outlaw_count", source, "public_aggregate");
    }
    return {
      key: "confirmed_outlaw_count",
      available: true,
      value: n,
      detail: null,
      observedAt,
      source,
      privacy: "public_aggregate",
    };
  } catch {
    return unavailable("confirmed_outlaw_count", source, "public_aggregate");
  }
}

/**
 * Greenwood member count: active profiles with admission timestamp set.
 */
export async function readGreenwoodMemberCount(options?: {
  admin?: SupabaseClient;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.greenwood_member_count";
  const observedAt = options?.now?.() ?? nowIso();
  try {
    const admin = options?.admin ?? (await defaultAdmin());
    const n = await headCountActiveProfiles(admin, {
      greenwoodMembersOnly: true,
    });
    if (n == null) {
      return unavailable("greenwood_member_count", source, "public_aggregate");
    }
    return {
      key: "greenwood_member_count",
      available: true,
      value: n,
      detail: null,
      observedAt,
      source,
      privacy: "public_aggregate",
    };
  } catch {
    return unavailable("greenwood_member_count", source, "public_aggregate");
  }
}

/**
 * Configured lifetime LEAF threshold for Greenwood admission (config, not personal).
 */
export async function readGreenwoodLeafThreshold(options?: {
  loadThreshold?: () => Promise<number | null>;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.greenwood_leaf_threshold";
  const observedAt = options?.now?.() ?? nowIso();
  try {
    const load =
      options?.loadThreshold ?? getConfiguredGreenwoodLifetimeThreshold;
    const threshold = await load();
    if (threshold == null) {
      return unavailable("greenwood_leaf_threshold", source, "public_config");
    }
    let n: number;
    try {
      n = assertSafeIntegerAmount(
        threshold,
        "greenwood_leaf_threshold",
        "UNSAFE_BIGINT",
      );
    } catch {
      return unavailable("greenwood_leaf_threshold", source, "public_config");
    }
    if (n < 0) {
      return unavailable("greenwood_leaf_threshold", source, "public_config");
    }
    return {
      key: "greenwood_leaf_threshold",
      available: true,
      value: n,
      detail: "lifetime LEAF required for Greenwood admission",
      observedAt,
      source,
      privacy: "public_config",
    };
  } catch {
    return unavailable("greenwood_leaf_threshold", source, "public_config");
  }
}

/**
 * Official public $FENN token address (already-public contract, not private wallets).
 */
export async function readOfficialFennToken(options?: {
  loadToken?: () => Promise<{
    symbol: string;
    chainId: number;
    contractAddress: string;
    explorerUrl: string;
  } | null>;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.official_fenn_token";
  const observedAt = options?.now?.() ?? nowIso();
  try {
    const load = options?.loadToken ?? getPublicOfficialFennToken;
    const token = await load();
    if (!token) {
      return unavailable("official_fenn_token", source, "public_config");
    }
    const detail = [
      `symbol=${token.symbol}`,
      `chain_id=${token.chainId}`,
      `contract=${token.contractAddress}`,
      `explorer=${token.explorerUrl}`,
      "status=official_public_contract_configured",
    ].join("; ");
    return {
      key: "official_fenn_token",
      available: true,
      value: true,
      detail,
      observedAt,
      source,
      privacy: "public_config",
    };
  } catch {
    return unavailable("official_fenn_token", source, "public_config");
  }
}

export async function readCurrentPublicGathering(options?: {
  loadGathering?: () => Promise<{
    active: boolean;
    startsAt?: string;
    endsAt?: string;
    message?: string;
    serverNow: string;
  }>;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.current_public_gathering";
  try {
    const load =
      options?.loadGathering ??
      (async () => {
        const g = await getPublicHomeGatheringCall();
        if (g.active) {
          return {
            active: true as const,
            startsAt: g.startsAt,
            endsAt: g.endsAt,
            message: g.message,
            serverNow: g.serverNow,
          };
        }
        return { active: false as const, serverNow: g.serverNow };
      });
    const g = await load();
    const observedAt = g.serverNow || options?.now?.() || nowIso();
    if (g.active) {
      const detail = [
        `state=active`,
        g.startsAt ? `starts_at=${g.startsAt}` : null,
        g.endsAt ? `ends_at=${g.endsAt}` : null,
        g.message ? `message=${g.message}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      return {
        key: "current_public_gathering",
        available: true,
        value: true,
        detail,
        observedAt,
        source,
        privacy: "public_record",
      };
    }
    return {
      key: "current_public_gathering",
      available: true,
      value: false,
      detail: "state=inactive; no active public world Gathering on the map",
      observedAt,
      source,
      privacy: "public_record",
    };
  } catch {
    return unavailable("current_public_gathering", source, "public_record");
  }
}

export async function readLatestPublicChronicle(options?: {
  loadEntries?: () => Promise<
    Array<{
      id: string;
      kind: string;
      title: string | null;
      body: string;
      coveredDate: string | null;
      publishedAt: string;
    }>
  >;
  now?: () => string;
}): Promise<PublicFactEvidence> {
  const source = "public_fact_readers.latest_public_chronicle";
  const observedAt = options?.now?.() ?? nowIso();
  try {
    const load =
      options?.loadEntries ??
      (() => listPublicChronicleEntries({ limit: 1 }));
    const entries = await load();
    const latest = entries[0];
    if (!latest) {
      return {
        key: "latest_public_chronicle",
        available: true,
        value: false,
        detail: "no public Chronicle entries published",
        observedAt,
        source,
        privacy: "public_record",
      };
    }
    const bodyPreview =
      latest.body.length > 240
        ? `${latest.body.slice(0, 240).trimEnd()}…`
        : latest.body;
    const detail = [
      `kind=${latest.kind}`,
      latest.title ? `title=${JSON.stringify(latest.title)}` : null,
      latest.coveredDate ? `covered_date=${latest.coveredDate}` : null,
      `published_at=${latest.publishedAt}`,
      `body_preview=${JSON.stringify(bodyPreview)}`,
    ]
      .filter(Boolean)
      .join("; ");
    return {
      key: "latest_public_chronicle",
      available: true,
      value: true,
      detail,
      observedAt,
      source,
      privacy: "public_record",
    };
  } catch {
    return unavailable("latest_public_chronicle", source, "public_record");
  }
}

/** Register capability: both count facts. */
export async function readRegisterPublicFacts(options?: {
  admin?: SupabaseClient;
  now?: () => string;
}): Promise<PublicFactEvidence[]> {
  const [outlaws, members] = await Promise.all([
    readConfirmedOutlawCount(options),
    readGreenwoodMemberCount(options),
  ]);
  return [outlaws, members];
}
