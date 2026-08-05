/**
 * Safe registration origin for Clearing ↔ Register continuity.
 * No open redirect — only the fixed Clearing path may be restored.
 */

export const CLEARING_ORIGIN_STORAGE_KEY = "fenn_clearing_origin";
export const CLEARING_PATH = "/camp/clearing";
export const CLEARING_REGISTER_HREF = "/outlaw/register?from=clearing";

export function isClearingRegisterOrigin(from: string | null | undefined): boolean {
  return from === "clearing";
}

export function markClearingRegistrationOrigin(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CLEARING_ORIGIN_STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function consumeClearingRegistrationOrigin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.sessionStorage.getItem(CLEARING_ORIGIN_STORAGE_KEY);
    if (v === "1") {
      window.sessionStorage.removeItem(CLEARING_ORIGIN_STORAGE_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function peekClearingRegistrationOrigin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(CLEARING_ORIGIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
