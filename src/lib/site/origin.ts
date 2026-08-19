/**
 * Canonical site origin for VELL URLs (metadata, robots, sitemap, invites).
 * No secrets — public host only.
 */

export const PRODUCTION_SITE_ORIGIN = "https://askvell.com";
export const PRODUCTION_SITE_HOST = "askvell.com";
const DEV_FALLBACK_ORIGIN = "http://localhost:3000";

export type SiteRuntimeHints = {
  siteUrl?: string | null;
  vercelEnv?: string | null;
  nodeEnv?: string | null;
};

function readEnvSiteUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function readVercelEnv(hints?: SiteRuntimeHints): string | undefined {
  const raw = hints?.vercelEnv ?? process.env.VERCEL_ENV;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNodeEnv(hints?: SiteRuntimeHints): string {
  const raw = hints?.nodeEnv ?? process.env.NODE_ENV;
  return typeof raw === "string" && raw.length > 0 ? raw : "development";
}

/**
 * True when this process is a Vercel preview (or similar non-production deploy).
 */
export function isPreviewDeployment(hints?: SiteRuntimeHints): boolean {
  const vercelEnv = readVercelEnv(hints);
  return vercelEnv === "preview" || vercelEnv === "development";
}

/**
 * Vercel production slot — strictest canonical policy applies.
 */
export function isVercelProductionDeployment(hints?: SiteRuntimeHints): boolean {
  return readVercelEnv(hints) === "production";
}

/**
 * True for the production deployment / production server process.
 * Includes Vercel production and non-Vercel hosts that self-identify as production.
 */
export function isProductionDeployment(hints?: SiteRuntimeHints): boolean {
  if (isVercelProductionDeployment(hints)) return true;
  if (isPreviewDeployment(hints)) return false;
  return readNodeEnv(hints) === "production";
}

/**
 * Preview and non-production deploys must not be indexed.
 * Self-host / Vercel production with the production origin may be indexed.
 */
export function shouldNoIndexDeployment(hints?: SiteRuntimeHints): boolean {
  if (isPreviewDeployment(hints)) return true;
  if (isVercelProductionDeployment(hints)) return false;

  // Local `next build` / `next start` and pure development stay noindex
  // unless the configured origin is the real production host.
  if (readNodeEnv(hints) !== "production") return true;

  try {
    return resolveMetadataSiteOrigin(hints) !== PRODUCTION_SITE_ORIGIN;
  } catch {
    return true;
  }
}

/** Legacy / typo domains — never accept as a VELL origin. */
export function isLegacyOrTypoHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "amfenn.com" ||
    host.endsWith(".amfenn.com") ||
    host === "imfenn.com" ||
    host.endsWith(".imfenn.com")
  );
}

/**
 * Hosts that must never appear in public metadata / sitemap / robots host.
 */
export function isForbiddenCanonicalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (isLegacyOrTypoHost(host)) return true;
  if (host.endsWith(".vercel.app")) return true;
  return false;
}

/**
 * Normalise a site URL to origin only (scheme + host [+ port]), no trailing slash.
 * Accepts only http: / https:. Always rejects the amfenn typo domain.
 */
export function normalizeSiteOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Site URL is empty");
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid site URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Site URL must use http or https (got ${url.protocol})`);
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new Error(`Site URL has no host: ${raw}`);
  }

  if (isLegacyOrTypoHost(host)) {
    throw new Error(`Site URL host is not allowed for VELL: ${host}`);
  }

  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}`;
}

/**
 * Origin for invite links, OAuth tooling, and general app URLs in the current env.
 * Lenient: prefers explicit arg / env / localhost. Still rejects amfenn.
 * May be a Vercel preview origin for non-SEO tooling only.
 */
export function resolveAppSiteOrigin(
  siteUrl?: string | null,
  hints?: SiteRuntimeHints,
): string {
  const raw = siteUrl?.trim() || hints?.siteUrl?.trim() || readEnvSiteUrl();
  if (raw) {
    return normalizeSiteOrigin(raw);
  }
  return DEV_FALLBACK_ORIGIN;
}

/**
 * Origin used for metadataBase, robots, sitemap and public canonical URLs.
 *
 * - Vercel production: must be https://askvell.com (fails closed if misconfigured).
 * - Vercel preview: always askvell.com (never *.vercel.app) + noindex via robots.
 * - Local development / local production builds: allow localhost from env.
 * - Forbidden hosts never escape into metadata.
 */
export function resolveMetadataSiteOrigin(hints?: SiteRuntimeHints): string {
  if (isPreviewDeployment(hints)) {
    return PRODUCTION_SITE_ORIGIN;
  }

  const raw = hints?.siteUrl?.trim() || readEnvSiteUrl();

  if (isVercelProductionDeployment(hints)) {
    if (!raw) {
      throw new Error(
        "NEXT_PUBLIC_SITE_URL is required in production for canonical metadata",
      );
    }

    const origin = normalizeSiteOrigin(raw);
    const host = new URL(origin).hostname.toLowerCase();

    if (host === "localhost" || host === "127.0.0.1") {
      throw new Error(
        "Production metadata cannot use localhost as NEXT_PUBLIC_SITE_URL",
      );
    }

    if (isForbiddenCanonicalHost(host) || host !== PRODUCTION_SITE_HOST) {
      throw new Error(
        `Production NEXT_PUBLIC_SITE_URL must be ${PRODUCTION_SITE_ORIGIN} (got ${origin})`,
      );
    }

    return PRODUCTION_SITE_ORIGIN;
  }

  if (raw) {
    const origin = normalizeSiteOrigin(raw);
    const host = new URL(origin).hostname.toLowerCase();
    if (isForbiddenCanonicalHost(host)) {
      // Mis-set preview-like host outside VERCEL_ENV=preview — never use it.
      return PRODUCTION_SITE_ORIGIN;
    }
    if (host === PRODUCTION_SITE_HOST) {
      return PRODUCTION_SITE_ORIGIN;
    }
    return origin;
  }

  return DEV_FALLBACK_ORIGIN;
}
