import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is this repository's root; never resolve a lockfile from a parent directory.
  turbopack: { root: path.resolve(import.meta.dirname) },
};

export default nextConfig;
