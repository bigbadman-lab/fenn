import type {
  GreenwoodAdmissionResult,
  GreenwoodStatus,
} from "@/lib/greenwood/types";

type ApiEnvelope = {
  ok?: boolean;
  status?: GreenwoodStatus;
  result?: GreenwoodAdmissionResult;
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
