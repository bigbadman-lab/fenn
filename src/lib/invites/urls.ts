import { resolveAppSiteOrigin } from "@/lib/site/origin";

/**
 * Resolve site origin for invite tooling.
 * Prefer NEXT_PUBLIC_SITE_URL; fall back only for non-production tooling.
 * Forbidden hosts (amfenn, *.vercel.app) are rejected by the shared normaliser.
 */
export function siteUrlOrigin(siteUrl?: string | null): string {
  return resolveAppSiteOrigin(siteUrl);
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
