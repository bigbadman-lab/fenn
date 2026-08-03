import type { MetadataRoute } from "next";

import { listPublicDeeds } from "@/lib/deeds/queries";
import {
  PUBLIC_SITEMAP_PATHS,
  resolveMetadataSiteOrigin,
} from "@/lib/site";

function absoluteUrl(origin: string, path: string): string {
  if (path === "/") return `${origin}/`;
  return `${origin}${path}`;
}

/**
 * Public sitemap only. Member, Desk, Admin, API and Hollow are excluded.
 * Deed DB failures still return the static public route list.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = resolveMetadataSiteOrigin();

  const entries: MetadataRoute.Sitemap = PUBLIC_SITEMAP_PATHS.map((path) => ({
    url: absoluteUrl(origin, path),
  }));

  try {
    const deeds = await listPublicDeeds();
    for (const deed of deeds) {
      const slug = deed.slug?.trim();
      if (!slug) continue;
      entries.push({
        url: absoluteUrl(origin, `/deeds/${encodeURIComponent(slug)}`),
        ...(deed.publishedAt
          ? { lastModified: new Date(deed.publishedAt) }
          : {}),
      });
    }
  } catch {
    // Fail open to static public routes only — never block sitemap entirely.
  }

  return entries;
}
