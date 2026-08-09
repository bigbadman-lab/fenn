/**
 * Sanitize provider errors for controlled P1B.1 calibration harness only.
 * Never include secrets, prompts, or Authorization material.
 */

export type HarnessProviderFailure = {
  stage:
    | "openai_unavailable"
    | "openai_timeout"
    | "openai_structured_request"
    | "openai_no_parsed"
    | "normalize"
    | "unknown";
  status: number | null;
  code: string | null;
  message: string;
};

const SECRET_HINT =
  /\b(sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key|private[_-]?key|authorization)\b/gi;

function scrub(s: string, max = 220): string {
  return s
    .replace(SECRET_HINT, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Extract a short, safe provider failure description from OpenAI SDK / network errors.
 */
export function sanitizeHarnessProviderFailure(
  error: unknown,
): HarnessProviderFailure {
  if (!error || typeof error !== "object") {
    return {
      stage: "unknown",
      status: null,
      code: null,
      message: scrub(String(error)),
    };
  }

  const e = error as {
    name?: string;
    status?: number;
    code?: string;
    message?: string;
    error?: {
      type?: string;
      code?: string;
      message?: string;
      param?: string;
    };
  };

  const name = e.name ?? "";
  const status = typeof e.status === "number" ? e.status : null;
  const nestedMsg =
    typeof e.error?.message === "string" ? e.error.message : null;
  const topMsg = typeof e.message === "string" ? e.message : null;
  const raw = nestedMsg ?? topMsg ?? name ?? "error";

  if (
    name === "OpenAIUnavailableError" ||
    /not configured/i.test(raw)
  ) {
    return {
      stage: "openai_unavailable",
      status: status ?? 503,
      code: e.code ?? e.error?.code ?? null,
      message: scrub(raw),
    };
  }

  if (
    status === 408 ||
    e.code === "timeout" ||
    name === "APIConnectionTimeoutError" ||
    /timed out/i.test(raw)
  ) {
    return {
      stage: "openai_timeout",
      status: status ?? 504,
      code: e.code ?? e.error?.code ?? null,
      message: scrub(raw),
    };
  }

  if (/no structured result/i.test(raw)) {
    return {
      stage: "openai_no_parsed",
      status: status ?? 502,
      code: e.code ?? e.error?.code ?? null,
      message: scrub(raw),
    };
  }

  if (
    status === 400 ||
    /Invalid schema|response_format|json_schema/i.test(raw)
  ) {
    return {
      stage: "openai_structured_request",
      status: status ?? 400,
      code: e.error?.code ?? e.code ?? null,
      message: scrub(raw),
    };
  }

  return {
    stage: "unknown",
    status,
    code: e.error?.code ?? e.code ?? null,
    message: scrub(raw),
  };
}
