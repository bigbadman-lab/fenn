import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep Turbopack rooted in this package even if a parent lockfile exists.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
