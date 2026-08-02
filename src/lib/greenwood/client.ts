import type { SafeDeed } from "@/lib/deeds/types";
import type {
  FireGatheringsSnapshot,
  SafeGathering,
} from "@/lib/greenwood/gatherings/types";
import type {
  HollowFireStatus,
  HollowInboxSnapshot,
  SafeHollowReward,
} from "@/lib/greenwood/hollow/types";
import type {
  FirePresenceSelfState,
  FirePresenceSnapshot,
} from "@/lib/greenwood/presence/types";
import type {
  GreenwoodAdmissionResult,
  GreenwoodStatus,
} from "@/lib/greenwood/types";

type ApiEnvelope = {
  ok?: boolean;
  status?: GreenwoodStatus;
  result?: GreenwoodAdmissionResult;
  deeds?: SafeDeed[];
  presence?: FirePresenceSnapshot;
  self?: FirePresenceSelfState;
  gatherings?: FireGatheringsSnapshot;
  gathering?: SafeGathering;
  hollow?: HollowInboxSnapshot;
  hollowStatus?: HollowFireStatus;
  reward?: SafeHollowReward;
  leafBalance?: number;
  leafLifetimeEarned?: number;
  newlyClaimed?: boolean;
  message?: { paragraphs?: string[]; fromFallback?: boolean };
  error?: string;
  code?: string;
};

export type GreenwoodClientError = {
  code: string;
  message: string;
  httpStatus: number;
};

export type GreenwoodStatusFetchResult =
  | { ok: true; status: GreenwoodStatus }
  | { ok: false; error: GreenwoodClientError };

export type GreenwoodSpeaksFetchResult =
  | { ok: true; paragraphs: string[]; fromFallback: boolean }
  | { ok: false; error: GreenwoodClientError };

/**
 * Authenticated GET /api/greenwood/speaks — current FENN SPEAKS for members.
 */
export async function fetchGreenwoodSpeaks(
  headers: HeadersInit,
): Promise<GreenwoodSpeaksFetchResult> {
  const response = await fetch("/api/greenwood/speaks", {
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (
    !response.ok ||
    !body?.ok ||
    !body.message ||
    !Array.isArray(body.message.paragraphs)
  ) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_fire_message_failed",
        "FENN SPEAKS failed",
      ),
    };
  }

  return {
    ok: true,
    paragraphs: body.message.paragraphs,
    fromFallback: Boolean(body.message.fromFallback),
  };
}

export type GreenwoodEnterFetchResult =
  | { ok: true; result: GreenwoodAdmissionResult }
  | { ok: false; error: GreenwoodClientError };

function asError(
  httpStatus: number,
  body: ApiEnvelope | null,
  fallbackCode: string,
  fallbackMessage: string,
): GreenwoodClientError {
  return {
    httpStatus,
    code: body?.code ?? fallbackCode,
    message: body?.error ?? fallbackMessage,
  };
}

/**
 * Authenticated GET /api/greenwood/status.
 * Caller supplies Bearer headers from useFennAuth().getAuthHeaders().
 */
export async function fetchGreenwoodStatus(
  headers: HeadersInit,
): Promise<GreenwoodStatusFetchResult> {
  const response = await fetch("/api/greenwood/status", {
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.status) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_status_failed",
        "Greenwood status failed",
      ),
    };
  }

  return { ok: true, status: body.status };
}

/**
 * Authenticated POST /api/greenwood/enter with an empty body.
 * Never sends profileId / LEAF / threshold from the client.
 */
export async function postGreenwoodEnter(
  headers: HeadersInit,
): Promise<GreenwoodEnterFetchResult> {
  const response = await fetch("/api/greenwood/enter", {
    method: "POST",
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.result) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_admission_failed",
        "Greenwood admission failed",
      ),
    };
  }

  return { ok: true, result: body.result };
}

export type GreenwoodArrivalCeremonyCompleteResult =
  | {
      ok: true;
      result: {
        status: "completed" | "already_completed";
        completedAt: string | null;
      };
    }
  | { ok: false; error: GreenwoodClientError };

/**
 * Authenticated POST /api/greenwood/arrival-ceremony/complete.
 * Idempotent. Empty body. Never sends profile IDs from the client.
 */
export async function postGreenwoodArrivalCeremonyComplete(
  headers: HeadersInit,
): Promise<GreenwoodArrivalCeremonyCompleteResult> {
  const response = await fetch("/api/greenwood/arrival-ceremony/complete", {
    method: "POST",
    headers,
    cache: "no-store",
  });

  type CeremonyCompleteBody = {
    ok?: boolean;
    error?: string;
    code?: string;
    result?: {
      status?: string;
      completedAt?: string | null;
    };
  };

  let body: CeremonyCompleteBody | null = null;
  try {
    body = (await response.json()) as CeremonyCompleteBody;
  } catch {
    body = null;
  }

  const status = body?.result?.status;
  if (
    !response.ok ||
    !body?.ok ||
    !body.result ||
    (status !== "completed" && status !== "already_completed")
  ) {
    return {
      ok: false,
      error: {
        httpStatus: response.status,
        code: body?.code ?? "greenwood_status_failed",
        message: body?.error ?? "Arrival ceremony completion failed",
      },
    };
  }

  return {
    ok: true,
    result: {
      status,
      completedAt: body.result.completedAt ?? null,
    },
  };
}

export type GreenwoodDeedsFetchResult =
  | { ok: true; deeds: SafeDeed[] }
  | { ok: false; error: GreenwoodClientError };

/**
 * Authenticated GET /api/greenwood/deeds.
 * Server verifies Greenwood membership before returning the projection.
 */
export async function fetchGreenwoodDeeds(
  headers: HeadersInit,
): Promise<GreenwoodDeedsFetchResult> {
  const response = await fetch("/api/greenwood/deeds", {
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !Array.isArray(body.deeds)) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_deeds_failed",
        "Greenwood deeds failed",
      ),
    };
  }

  return { ok: true, deeds: body.deeds };
}

export type GreenwoodPresenceFetchResult =
  | { ok: true; presence: FirePresenceSnapshot }
  | { ok: false; error: GreenwoodClientError };

export type GreenwoodPresenceSelfFetchResult =
  | { ok: true; self: FirePresenceSelfState }
  | { ok: false; error: GreenwoodClientError };

export type FireSelfStatusPayload = {
  member: boolean;
  active: boolean;
  sitting: boolean;
};

export type GreenwoodFireSelfStatusFetchResult =
  | { ok: true; status: FireSelfStatusPayload }
  | { ok: false; error: GreenwoodClientError };

/**
 * Authenticated GET /api/greenwood/presence/self — compact shell status.
 */
export async function fetchGreenwoodFireSelfStatus(
  headers: HeadersInit,
): Promise<GreenwoodFireSelfStatusFetchResult> {
  const response = await fetch("/api/greenwood/presence/self", {
    headers,
    cache: "no-store",
  });

  type SelfStatusBody = {
    ok?: boolean;
    status?: FireSelfStatusPayload;
    error?: string;
    code?: string;
  };

  let body: SelfStatusBody | null = null;
  try {
    body = (await response.json()) as SelfStatusBody;
  } catch {
    body = null;
  }

  if (
    !response.ok ||
    !body?.ok ||
    !body.status ||
    typeof body.status.member !== "boolean" ||
    typeof body.status.active !== "boolean" ||
    typeof body.status.sitting !== "boolean"
  ) {
    return {
      ok: false,
      error: asError(
        response.status,
        body
          ? { ok: body.ok, error: body.error, code: body.code }
          : null,
        "greenwood_presence_failed",
        "Fire status failed",
      ),
    };
  }

  return { ok: true, status: body.status };
}

/**
 * Authenticated GET /api/greenwood/presence.
 * Member-safe Fire presence only — no profile IDs or wallets.
 */
export async function fetchGreenwoodPresence(
  headers: HeadersInit,
): Promise<GreenwoodPresenceFetchResult> {
  const response = await fetch("/api/greenwood/presence", {
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.presence) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_presence_failed",
        "Fire presence failed",
      ),
    };
  }

  return { ok: true, presence: body.presence };
}

async function postPresenceAction(
  path: string,
  headers: HeadersInit,
  fallbackMessage: string,
): Promise<GreenwoodPresenceSelfFetchResult> {
  const response = await fetch(path, {
    method: "POST",
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.self) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_presence_failed",
        fallbackMessage,
      ),
    };
  }

  return { ok: true, self: body.self };
}

/** Authenticated POST /api/greenwood/presence/heartbeat — empty body. */
export async function postGreenwoodPresenceHeartbeat(
  headers: HeadersInit,
): Promise<GreenwoodPresenceSelfFetchResult> {
  return postPresenceAction(
    "/api/greenwood/presence/heartbeat",
    headers,
    "Fire heartbeat failed",
  );
}

/** Authenticated POST /api/greenwood/presence/sit — empty body. */
export async function postGreenwoodPresenceSit(
  headers: HeadersInit,
): Promise<GreenwoodPresenceSelfFetchResult> {
  return postPresenceAction(
    "/api/greenwood/presence/sit",
    headers,
    "Sit by the Fire failed",
  );
}

/** Authenticated POST /api/greenwood/presence/leave — empty body. */
export async function postGreenwoodPresenceLeave(
  headers: HeadersInit,
): Promise<GreenwoodPresenceSelfFetchResult> {
  return postPresenceAction(
    "/api/greenwood/presence/leave",
    headers,
    "Leave the Fire failed",
  );
}

export type GreenwoodGatheringsFetchResult =
  | { ok: true; gatherings: FireGatheringsSnapshot }
  | { ok: false; error: GreenwoodClientError };

export type GreenwoodGatheringActionResult =
  | { ok: true; gathering: SafeGathering }
  | { ok: false; error: GreenwoodClientError };

export async function fetchGreenwoodGatherings(
  headers: HeadersInit,
): Promise<GreenwoodGatheringsFetchResult> {
  const response = await fetch("/api/greenwood/gatherings", {
    headers,
    cache: "no-store",
  });
  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok || !body.gatherings) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_gathering_failed",
        "Gatherings failed",
      ),
    };
  }
  return { ok: true, gatherings: body.gatherings };
}

async function postGatheringHand(
  path: string,
  headers: HeadersInit,
  fallback: string,
): Promise<GreenwoodGatheringActionResult> {
  const response = await fetch(path, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok || !body.gathering) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_gathering_failed",
        fallback,
      ),
    };
  }
  return { ok: true, gathering: body.gathering };
}

export async function postRaiseGatheringHand(
  gatheringId: string,
  headers: HeadersInit,
): Promise<GreenwoodGatheringActionResult> {
  return postGatheringHand(
    `/api/greenwood/gatherings/${gatheringId}/raise-hand`,
    headers,
    "Raise Hand failed",
  );
}

export async function postLowerGatheringHand(
  gatheringId: string,
  headers: HeadersInit,
): Promise<GreenwoodGatheringActionResult> {
  return postGatheringHand(
    `/api/greenwood/gatherings/${gatheringId}/lower-hand`,
    headers,
    "Lower Hand failed",
  );
}

export type GreenwoodHollowFetchResult =
  | { ok: true; hollow: HollowInboxSnapshot }
  | { ok: false; error: GreenwoodClientError };

export type GreenwoodHollowStatusFetchResult =
  | { ok: true; status: HollowFireStatus }
  | { ok: false; error: GreenwoodClientError };

export type GreenwoodHollowClaimResult =
  | {
      ok: true;
      reward: SafeHollowReward;
      leafBalance: number;
      leafLifetimeEarned: number;
      newlyClaimed: boolean;
    }
  | { ok: false; error: GreenwoodClientError };

export async function fetchGreenwoodHollow(
  headers: HeadersInit,
): Promise<GreenwoodHollowFetchResult> {
  const response = await fetch("/api/greenwood/hollow", {
    headers,
    cache: "no-store",
  });
  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok || !body.hollow) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_hollow_failed",
        "The Hollow failed",
      ),
    };
  }
  return { ok: true, hollow: body.hollow };
}

export async function fetchGreenwoodHollowStatus(
  headers: HeadersInit,
): Promise<GreenwoodHollowStatusFetchResult> {
  const response = await fetch("/api/greenwood/hollow/status", {
    headers,
    cache: "no-store",
  });
  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok || !body.hollowStatus) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_hollow_failed",
        "Hollow status failed",
      ),
    };
  }
  return { ok: true, status: body.hollowStatus };
}

export async function postClaimHollowReward(
  rewardId: string,
  headers: HeadersInit,
): Promise<GreenwoodHollowClaimResult> {
  const response = await fetch(`/api/greenwood/hollow/${rewardId}/claim`, {
    method: "POST",
    headers,
    cache: "no-store",
  });
  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }
  if (
    !response.ok ||
    !body?.ok ||
    !body.reward ||
    body.leafBalance == null ||
    body.leafLifetimeEarned == null
  ) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "greenwood_hollow_failed",
        "Claim failed",
      ),
    };
  }
  return {
    ok: true,
    reward: body.reward,
    leafBalance: body.leafBalance,
    leafLifetimeEarned: body.leafLifetimeEarned,
    newlyClaimed: Boolean(body.newlyClaimed),
  };
}
