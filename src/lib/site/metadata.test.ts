import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEED_METADATA_DESCRIPTION_FALLBACK,
  FENN_DEFAULT_DESCRIPTION,
  FENN_FAVICON,
  FENN_FAVICON_PATH,
  FENN_OG_IMAGE,
  FENN_OG_IMAGE_PATH,
  FENN_X_HANDLE,
  PRIVATE_ROBOTS,
  PUBLIC_SITEMAP_PATHS,
  ROBOTS_DISALLOW_PATHS,
  buildHomeMetadata,
  buildPrivateMetadata,
  buildPublicMetadata,
  buildRootMetadata,
  normalizePublicDescription,
  socialTitleFromSegment,
} from "@/lib/site/metadata";
import {
  PRODUCTION_SITE_ORIGIN,
  isForbiddenCanonicalHost,
  isPreviewDeployment,
  normalizeSiteOrigin,
  resolveAppSiteOrigin,
  resolveMetadataSiteOrigin,
  shouldNoIndexDeployment,
} from "@/lib/site/origin";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(repo, rel));
}

const prodRuntime = {
  nodeEnv: "production",
  vercelEnv: "production",
  siteUrl: PRODUCTION_SITE_ORIGIN,
} as const;

const previewRuntime = {
  nodeEnv: "production",
  vercelEnv: "preview",
  siteUrl: "https://fenn-git-main-user.vercel.app",
} as const;

const devRuntime = {
  nodeEnv: "development",
  vercelEnv: undefined,
  siteUrl: "http://localhost:3000",
} as const;

describe("site origin", () => {
  it("normalises trailing slashes and requires http(s)", () => {
    assert.equal(
      normalizeSiteOrigin("https://imfenn.com/"),
      PRODUCTION_SITE_ORIGIN,
    );
    assert.equal(
      normalizeSiteOrigin("http://localhost:3000/"),
      "http://localhost:3000",
    );
    assert.throws(() => normalizeSiteOrigin("ftp://imfenn.com"));
    assert.throws(() => normalizeSiteOrigin("https://amfenn.com"));
  });

  it("rejects amfenn and treats vercel.app as forbidden for canonical metadata", () => {
    assert.equal(isForbiddenCanonicalHost("amfenn.com"), true);
    assert.equal(isForbiddenCanonicalHost("foo.vercel.app"), true);
    assert.equal(isForbiddenCanonicalHost("imfenn.com"), false);
  });

  it("production metadata origin fails closed without valid imfenn.com", () => {
    assert.equal(
      resolveMetadataSiteOrigin(prodRuntime),
      PRODUCTION_SITE_ORIGIN,
    );
    assert.throws(() =>
      resolveMetadataSiteOrigin({
        ...prodRuntime,
        siteUrl: "http://localhost:3000",
      }),
    );
    assert.throws(() =>
      resolveMetadataSiteOrigin({
        ...prodRuntime,
        siteUrl: "https://amfenn.com",
      }),
    );
    assert.throws(() =>
      resolveMetadataSiteOrigin({
        ...prodRuntime,
        siteUrl: "https://fenn.vercel.app",
      }),
    );
    const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    try {
      assert.throws(() =>
        resolveMetadataSiteOrigin({
          nodeEnv: "production",
          vercelEnv: "production",
        }),
      );
    } finally {
      if (prevSite === undefined) {
        delete process.env.NEXT_PUBLIC_SITE_URL;
      } else {
        process.env.NEXT_PUBLIC_SITE_URL = prevSite;
      }
    }
  });

  it("local production builds may use localhost for metadata tooling", () => {
    assert.equal(
      resolveMetadataSiteOrigin({
        nodeEnv: "production",
        siteUrl: "http://localhost:3000",
      }),
      "http://localhost:3000",
    );
  });

  it("preview metadata never publishes vercel.app and stays on imfenn.com", () => {
    assert.equal(isPreviewDeployment(previewRuntime), true);
    assert.equal(
      resolveMetadataSiteOrigin(previewRuntime),
      PRODUCTION_SITE_ORIGIN,
    );
    assert.equal(shouldNoIndexDeployment(previewRuntime), true);
  });

  it("development allows localhost app origins", () => {
    assert.equal(
      resolveAppSiteOrigin("http://localhost:3000/"),
      "http://localhost:3000",
    );
    assert.equal(
      resolveMetadataSiteOrigin(devRuntime),
      "http://localhost:3000",
    );
    assert.equal(shouldNoIndexDeployment(devRuntime), true);
  });
});

describe("root and shared metadata", () => {
  it("root metadata title is exactly FENN with template branding", () => {
    const root = buildRootMetadata(prodRuntime);
    assert.deepEqual(root.title, {
      default: "FENN",
      template: "%s — FENN",
    });
    assert.equal(root.description, FENN_DEFAULT_DESCRIPTION);
    assert.equal(root.description, "The road ends here. The wood begins.");
    assert.equal(root.applicationName, "FENN");
  });

  it("metadata base uses canonical production origin", () => {
    const root = buildRootMetadata(prodRuntime);
    assert.ok(root.metadataBase instanceof URL);
    assert.equal(root.metadataBase?.origin, PRODUCTION_SITE_ORIGIN);
  });

  it("global OG image is /og.jpg at 1200×630 with FENN alt", () => {
    const root = buildRootMetadata(prodRuntime);
    const images = root.openGraph?.images;
    assert.ok(Array.isArray(images) && images[0]);
    const image = images[0] as {
      url: string;
      width: number;
      height: number;
      alt: string;
    };
    assert.equal(image.url, FENN_OG_IMAGE_PATH);
    assert.equal(image.url, "/og.jpg");
    assert.equal(image.width, 1200);
    assert.equal(image.height, 630);
    assert.equal(image.alt, "FENN");
    assert.equal(FENN_OG_IMAGE.width, 1200);
    assert.equal(FENN_OG_IMAGE.height, 630);
  });

  it("X card uses summary_large_image and @askfenn", () => {
    const root = buildRootMetadata(prodRuntime);
    const twitter = root.twitter;
    assert.ok(twitter && typeof twitter === "object");
    assert.equal(
      "card" in twitter ? twitter.card : undefined,
      "summary_large_image",
    );
    assert.equal(
      "site" in twitter ? twitter.site : undefined,
      FENN_X_HANDLE,
    );
    assert.equal(
      "creator" in twitter ? twitter.creator : undefined,
      FENN_X_HANDLE,
    );
    assert.equal(
      "site" in twitter ? twitter.site : undefined,
      "@askfenn",
    );
    assert.deepEqual(
      "images" in twitter ? twitter.images : undefined,
      ["/og.jpg"],
    );
  });

  it("homepage metadata is absolute FENN without template doubling", () => {
    const home = buildHomeMetadata(prodRuntime);
    assert.deepEqual(home.title, { absolute: "FENN" });
    assert.equal(home.description, FENN_DEFAULT_DESCRIPTION);
    assert.equal(home.alternates?.canonical, "/");
    assert.equal(home.openGraph?.title, "FENN");
    assert.equal(socialTitleFromSegment("FENN", true), "FENN");
    assert.notEqual(home.title, "FENN — FENN");
  });

  it("public child titles brand once via social title", () => {
    const meta = buildPublicMetadata({
      title: "CAMP",
      description: "Sit by the fire. Speak with the Camp. Some words leave a mark.",
      path: "/camp",
      runtime: prodRuntime,
    });
    assert.equal(meta.title, "CAMP");
    assert.equal(meta.openGraph?.title, "CAMP — FENN");
    assert.equal(meta.twitter?.title, "CAMP — FENN");
    assert.equal(socialTitleFromSegment("CAMP"), "CAMP — FENN");
    assert.doesNotMatch(String(meta.openGraph?.title), /FENN — FENN/);
  });

  it("canonicals are path-only without query parameters", () => {
    const meta = buildPublicMetadata({
      title: "THE LEDGER",
      description: "x",
      path: "/ledger?before=1&id=2",
      runtime: prodRuntime,
    });
    assert.equal(meta.alternates?.canonical, "/ledger");
    const greenwood = buildPublicMetadata({
      title: "THE GREENWOOD",
      description: "y",
      path: "/greenwood?crossing=1",
      runtime: prodRuntime,
    });
    assert.equal(greenwood.alternates?.canonical, "/greenwood");
  });

  it("explicitly preserves shared OG image on page-level openGraph", () => {
    const meta = buildPublicMetadata({
      title: "THE WALL",
      description: "Marks left by FENN for the world to read.",
      path: "/wall",
      runtime: prodRuntime,
    });
    const images = meta.openGraph?.images as Array<{ url: string }>;
    assert.equal(images[0]?.url, "/og.jpg");
    assert.deepEqual(meta.twitter?.images, ["/og.jpg"]);
  });

  it("homepage and commons metadata contain no token contract address", () => {
    const home = buildHomeMetadata(prodRuntime);
    const commons = buildPublicMetadata({
      title: "THE COMMONS",
      description:
        "The FENN Treasury, public commitments and the official contract in full view.",
      path: "/commons",
      runtime: prodRuntime,
    });
    const blob = JSON.stringify({ home, commons });
    assert.doesNotMatch(blob, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(blob, /contract address/i);
  });

  it("OG absolute URL resolves through metadataBase to imfenn.com/og.jpg", () => {
    const root = buildRootMetadata(prodRuntime);
    assert.ok(root.metadataBase);
    const absolute = new URL(FENN_OG_IMAGE_PATH, root.metadataBase).href;
    assert.equal(absolute, "https://imfenn.com/og.jpg");
  });

  it("preview deployments are noindex", () => {
    const root = buildRootMetadata(previewRuntime);
    assert.deepEqual(root.robots, PRIVATE_ROBOTS);
    const publicPage = buildPublicMetadata({
      title: "CAMP",
      description: "x",
      path: "/camp",
      runtime: previewRuntime,
    });
    assert.deepEqual(publicPage.robots, PRIVATE_ROBOTS);
  });
});

describe("private and operator metadata", () => {
  it("outlaw is noindex/nofollow with YOUR OUTLAW title", () => {
    const meta = buildPrivateMetadata("YOUR OUTLAW");
    assert.equal(meta.title, "YOUR OUTLAW");
    assert.deepEqual(meta.robots, { index: false, follow: false });
    assert.match(read("src/app/outlaw/layout.tsx"), /YOUR OUTLAW/);
    assert.match(read("src/app/outlaw/layout.tsx"), /buildPrivateMetadata/);
  });

  it("desk layout is noindex without doubled branding in titles", () => {
    const layout = read("src/app/desk/layout.tsx");
    assert.match(layout, /buildPrivateMetadata\("THE DESK"\)/);
    const agent = read("src/app/desk/agent/page.tsx");
    assert.match(agent, /title:\s*"THE AGENT"/);
    assert.doesNotMatch(agent, /\| FENN|— FENN/);
    const speak = read("src/app/desk/speaks/page.tsx");
    assert.doesNotMatch(speak, /FENN SPEAKS \| THE DESK \| FENN/);
    const editorial = read("src/app/desk/editorial/page.tsx");
    assert.match(editorial, /THE EDITORIAL ROOM/);
  });

  it("admin layout and pages avoid doubled FENN branding", () => {
    const layout = read("src/app/admin/layout.tsx");
    assert.match(layout, /buildPrivateMetadata\("ADMIN"\)/);
    assert.match(read("src/app/admin/deeds/page.tsx"), /ADMIN · DEEDS/);
    assert.doesNotMatch(
      read("src/app/admin/greenwood/speaks/page.tsx"),
      /Admin · FENN SPEAKS/,
    );
  });

  it("greenwood hollow remains noindex", () => {
    const hollow = read("src/app/greenwood/hollow/page.tsx");
    assert.match(hollow, /buildPrivateMetadata\("THE HOLLOW"\)/);
  });

  it("metadata helpers never embed wallet or submission identifiers", () => {
    const meta = buildPublicMetadata({
      title: "DEEDS",
      description: "Work worth doing.",
      path: "/deeds",
      runtime: prodRuntime,
    });
    const blob = JSON.stringify(meta);
    assert.doesNotMatch(blob, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(blob, /submission/i);
    assert.doesNotMatch(blob, /profileId|wallet/i);
  });
});

describe("deed metadata helpers", () => {
  it("uses public lore when safe and falls back for empty lore", () => {
    assert.equal(
      normalizePublicDescription("  A short public lore.  ", DEED_METADATA_DESCRIPTION_FALLBACK),
      "A short public lore.",
    );
    assert.equal(
      normalizePublicDescription("", DEED_METADATA_DESCRIPTION_FALLBACK),
      DEED_METADATA_DESCRIPTION_FALLBACK,
    );
    assert.equal(
      DEED_METADATA_DESCRIPTION_FALLBACK,
      "A Deed waiting to be witnessed in FENN.",
    );
  });

  it("deed page uses cached public fetch and safe missing metadata", () => {
    const source = read("src/app/deeds/[slug]/page.tsx");
    assert.match(source, /getPublicDeedBySlugCached/);
    assert.match(source, /missingDeedMetadata/);
    assert.match(source, /DEED_METADATA_DESCRIPTION_FALLBACK/);
    assert.match(source, /loreDescription/);
    assert.doesNotMatch(source, /instructions/);
    assert.doesNotMatch(source, /submission/);
  });
});

describe("robots and sitemap sources", () => {
  it("robots disallows private/operator/API paths and allows public roots conceptually", () => {
    const robotsSrc = read("src/app/robots.ts");
    for (const path of ROBOTS_DISALLOW_PATHS) {
      assert.ok(
        ROBOTS_DISALLOW_PATHS.includes(path),
        `expected disallow ${path}`,
      );
    }
    assert.match(robotsSrc, /ROBOTS_DISALLOW_PATHS/);
    assert.match(robotsSrc, /shouldNoIndexDeployment/);
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/outlaw"));
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/desk"));
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/admin"));
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/api"));
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/enter"));
    assert.ok(ROBOTS_DISALLOW_PATHS.includes("/greenwood/hollow"));

    for (const publicPath of PUBLIC_SITEMAP_PATHS) {
      assert.ok(
        !ROBOTS_DISALLOW_PATHS.includes(
          publicPath as (typeof ROBOTS_DISALLOW_PATHS)[number],
        ),
      );
    }
  });

  it("sitemap lists all static public routes and excludes private routes", () => {
    const src = read("src/app/sitemap.ts");
    assert.match(src, /PUBLIC_SITEMAP_PATHS/);
    assert.match(src, /listPublicDeeds/);
    assert.doesNotMatch(src, /\/outlaw|\/desk|\/admin|\/enter/);
    assert.deepEqual([...PUBLIC_SITEMAP_PATHS], [
      "/",
      "/book",
      "/oak",
      "/camp",
      "/deeds",
      "/greenwood",
      "/ledger",
      "/commons",
      "/wall",
    ]);
  });
});

describe("assets and public route wiring", () => {
  it("/og.jpg exists at repository public path", () => {
    assert.equal(fileExists("public/og.jpg"), true);
    const size = statSync(join(repo, "public/og.jpg")).size;
    assert.ok(size > 1000);
  });

  it("wires /favicon.jpg as tab and apple identity icons", () => {
    assert.equal(fileExists("public/favicon.jpg"), true);
    assert.equal(FENN_FAVICON_PATH, "/favicon.jpg");
    assert.equal(FENN_FAVICON.type, "image/jpeg");
    assert.equal(FENN_FAVICON.sizes, "50x50");

    const root = buildRootMetadata(prodRuntime);
    const icons = root.icons;
    assert.ok(icons && typeof icons === "object" && !Array.isArray(icons));

    const iconList = Array.isArray(icons.icon) ? icons.icon : [icons.icon];
    const iconEntry = iconList[0] as { url?: string; type?: string; sizes?: string };
    assert.equal(iconEntry?.url, "/favicon.jpg");
    assert.equal(iconEntry?.type, "image/jpeg");

    const appleList = Array.isArray(icons.apple) ? icons.apple : [icons.apple];
    const appleEntry = appleList[0] as { url?: string };
    assert.equal(appleEntry?.url, "/favicon.jpg");

    assert.ok(root.metadataBase);
    assert.equal(
      new URL(FENN_FAVICON_PATH, root.metadataBase).href,
      "https://imfenn.com/favicon.jpg",
    );
  });

  it("public route pages use buildPublicMetadata with required copy", () => {
    const expected: Array<[string, string, string]> = [
      ["src/app/camp/page.tsx", "CAMP", "/camp"],
      ["src/app/book/page.tsx", "THE BOOK", "/book"],
      ["src/app/oak/page.tsx", "THE OAK", "/oak"],
      ["src/app/deeds/page.tsx", "DEEDS", "/deeds"],
      ["src/app/greenwood/page.tsx", "THE GREENWOOD", "/greenwood"],
      ["src/app/ledger/page.tsx", "THE LEDGER", "/ledger"],
      ["src/app/commons/page.tsx", "THE COMMONS", "/commons"],
      ["src/app/wall/page.tsx", "THE WALL", "/wall"],
    ];
    for (const [file, title, path] of expected) {
      const src = read(file);
      assert.match(src, /buildPublicMetadata/);
      assert.match(src, new RegExp(`title:\\s*"${title}"`));
      assert.match(src, new RegExp(`path:\\s*"${path}"`));
    }
    assert.match(read("src/app/page.tsx"), /buildHomeMetadata/);
  });

  it("404 is noindex NOT FOUND", () => {
    const src = read("src/app/not-found.tsx");
    assert.match(src, /title:\s*"NOT FOUND"/);
    assert.match(src, /PRIVATE_ROBOTS|index:\s*false/);
    assert.match(src, /RETURN TO FENN/);
  });

  it("error page avoids stack traces in UI", () => {
    const src = read("src/app/error.tsx");
    assert.match(src, /"use client"/);
    assert.doesNotMatch(src, /error\.stack|stack trace/i);
    assert.match(src, /TRY AGAIN|RETURN TO FENN/);
  });

  it("OAuth callback HTML is noindex", () => {
    const src = read("src/app/api/auth/x/callback/route.ts");
    assert.match(src, /noindex,\s*nofollow/);
  });
});
