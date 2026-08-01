import type { SafeDeed } from "@/lib/deeds/types";
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
