/**
 * Resolve site origin without throwing at module load (tests / partial env).
 * Prefer NEXT_PUBLIC_SITE_URL; fall back only for non-production tooling.
 */
export function siteUrlOrigin(siteUrl?: string | null): string {
  const fromArg = siteUrl?.trim();
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const raw = fromArg || fromEnv || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/**
 * Canonical invite URL for the current environment.
 * Shape: {SITE}/enter?invite={code}
 */
export function buildOutlawInviteUrl(
  inviteCode: string,
  siteUrl?: string | null,
): string {
  const base = siteUrlOrigin(siteUrl);
  const code = inviteCode.trim();
  return `${base}/enter?invite=${encodeURIComponent(code)}`;
}
