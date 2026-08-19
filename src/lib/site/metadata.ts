import type { Metadata } from "next";

import {
  resolveMetadataSiteOrigin,
  shouldNoIndexDeployment,
  type SiteRuntimeHints,
} from "@/lib/site/origin";

/** Default and homepage description — keep minimal, no token addresses. */
export const FENN_DEFAULT_DESCRIPTION = "VELL is here.";

export const FENN_OG_IMAGE_PATH = "/og.jpg";

export const FENN_OG_IMAGE = {
  url: FENN_OG_IMAGE_PATH,
  width: 1200,
  height: 630,
  alt: "VELL",
} as const;

/**
 * Browser tab / pin identity — App Router + public `/favicon.ico`
 * (built from square branding in `public/favicon.jpg`).
 */
export const FENN_FAVICON_PATH = "/favicon.ico";

export const FENN_FAVICON = {
  url: FENN_FAVICON_PATH,
  type: "image/x-icon",
  sizes: "50x50",
} as const;

export const FENN_X_HANDLE = "@thisisvell";

/** Preferred description when a public Deed has no usable lore. */
export const DEED_METADATA_DESCRIPTION_FALLBACK =
  "A Deed waiting to be witnessed in VELL.";

export const PRIVATE_ROBOTS = {
  index: false,
  follow: false,
} as const;

const PUBLIC_INDEX_ROBOTS = {
  index: true,
  follow: true,
} as const;

export type PublicMetadataInput = {
  /** Title segment only — root template appends " — VELL". Use absoluteHome for `/`. */
  title: string;
  description: string;
  /** Path without origin or query, e.g. `/camp` or `/`. */
  path: string;
  /** Homepage: title is absolute "FENN" (avoid template "FENN — FENN"). */
  absoluteTitle?: boolean;
  /** Force noindex (missing deed, etc.). */
  noindex?: boolean;
  runtime?: SiteRuntimeHints;
};

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // Path-only: drop any accidental query/hash.
  const noQuery = withSlash.split("?")[0]?.split("#")[0] ?? "/";
  if (noQuery.length > 1 && noQuery.endsWith("/")) {
    return noQuery.slice(0, -1);
  }
  return noQuery;
}

/**
 * Social title always includes the brand once.
 * Document title uses the segment + root template (unless absolute).
 */
export function socialTitleFromSegment(
  segment: string,
  absoluteTitle?: boolean,
): string {
  if (absoluteTitle || segment === "VELL") return "VELL";
  return `${segment} — VELL`;
}

/**
 * Collapse public lore into a single-line meta description.
 * Never pass private submission/evidence fields here.
 */
export function normalizePublicDescription(
  value: string | null | undefined,
  fallback: string,
  maxLength = 160,
): string {
  if (!value) return fallback;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return fallback;
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[.,;:!\-—–\s]+$/u, "")}…`;
}

export function buildPrivateMetadata(title: string): Metadata {
  return {
    title,
    robots: PRIVATE_ROBOTS,
  };
}

/**
 * Shared public route metadata: title segment, description, path-only canonical,
 * OG + X with the shared social image (explicit so page OG fields keep the image).
 */
export function buildPublicMetadata(input: PublicMetadataInput): Metadata {
  const path = normalizePath(input.path);
  const noindex =
    input.noindex === true || shouldNoIndexDeployment(input.runtime);
  const socialTitle = socialTitleFromSegment(
    input.title,
    input.absoluteTitle,
  );

  return {
    title: input.absoluteTitle
      ? { absolute: input.title }
      : input.title,
    description: input.description,
    alternates: {
      canonical: path,
    },
    robots: noindex ? PRIVATE_ROBOTS : PUBLIC_INDEX_ROBOTS,
    openGraph: {
      type: "website",
      siteName: "VELL",
      title: socialTitle,
      description: input.description,
      url: path,
      images: [
        {
          url: FENN_OG_IMAGE.url,
          width: FENN_OG_IMAGE.width,
          height: FENN_OG_IMAGE.height,
          alt: FENN_OG_IMAGE.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: input.description,
      images: [FENN_OG_IMAGE_PATH],
      site: FENN_X_HANDLE,
      creator: FENN_X_HANDLE,
    },
  };
}

export function buildHomeMetadata(runtime?: SiteRuntimeHints): Metadata {
  return buildPublicMetadata({
    title: "VELL",
    description: FENN_DEFAULT_DESCRIPTION,
    path: "/",
    absoluteTitle: true,
    runtime,
  });
}

/**
 * Root layout metadata: defaults, metadataBase, shared OG/X, home-level fields.
 */
export function buildRootMetadata(runtime?: SiteRuntimeHints): Metadata {
  const origin = resolveMetadataSiteOrigin(runtime);
  const noindex = shouldNoIndexDeployment(runtime);

  return {
    metadataBase: new URL(origin),
    applicationName: "VELL",
    title: {
      default: "VELL",
      template: "%s — VELL",
    },
    description: FENN_DEFAULT_DESCRIPTION,
    icons: {
      // Primary tab icon: `src/app/favicon.ico` (App Router file convention → `/favicon.ico`).
      // Metadata only fills apple-touch so we do not emit a second conflicting favicon set.
      apple: [
        {
          url: FENN_FAVICON.url,
          type: FENN_FAVICON.type,
          sizes: FENN_FAVICON.sizes,
        },
      ],
    },
    robots: noindex ? PRIVATE_ROBOTS : PUBLIC_INDEX_ROBOTS,
    openGraph: {
      type: "website",
      siteName: "VELL",
      title: "VELL",
      description: FENN_DEFAULT_DESCRIPTION,
      url: "/",
      images: [
        {
          url: FENN_OG_IMAGE.url,
          width: FENN_OG_IMAGE.width,
          height: FENN_OG_IMAGE.height,
          alt: FENN_OG_IMAGE.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "VELL",
      description: FENN_DEFAULT_DESCRIPTION,
      images: [FENN_OG_IMAGE_PATH],
      site: FENN_X_HANDLE,
      creator: FENN_X_HANDLE,
    },
  };
}

/** Static public paths for sitemap and route matrix tests. */
export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/book",
  "/oak",
  "/camp",
  "/deeds",
  "/greenwood",
  "/ledger",
  "/commons",
  "/wall",
] as const;

export const ROBOTS_DISALLOW_PATHS = [
  "/outlaw",
  "/desk",
  "/admin",
  "/api",
  "/enter",
  "/greenwood/hollow",
] as const;
