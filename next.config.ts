import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep Turbopack rooted in this package even if a parent lockfile exists.
  turbopack: {
    root: projectRoot,
  },
  // Privy optional peers FENN does not use. `false` tells webpack to emit an
  // empty module so production builds do not fail on missing packages.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@stripe/crypto": false,
    };
    return config;
  },
};

export default nextConfig;
