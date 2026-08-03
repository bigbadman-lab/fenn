import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep Turbopack rooted in this package even if a parent lockfile exists.
  turbopack: {
    root: projectRoot,
  },
  // Privy optional peers (Farcaster/Solana mini-app) are not used; stub so
  // Webpack does not fail production builds that only need ethereum auth.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
    };
    return config;
  },
};

export default nextConfig;
