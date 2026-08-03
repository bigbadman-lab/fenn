import type { MetadataRoute } from "next";

import {
  ROBOTS_DISALLOW_PATHS,
  resolveMetadataSiteOrigin,
  shouldNoIndexDeployment,
} from "@/lib/site";

/**
 * Crawl policy for FENN.
 *
 * Production: allow public places; disallow member/operator/API surfaces.
 * Preview / non-production: disallow everything (pages also noindex).
 */
export default function robots(): MetadataRoute.Robots {
  const origin = resolveMetadataSiteOrigin();

  if (shouldNoIndexDeployment()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
      host: origin,
      sitemap: `${origin}/sitemap.xml`,
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW_PATHS],
    },
    host: origin,
    sitemap: `${origin}/sitemap.xml`,
  };
}
