import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same Turbopack workspace-root fix as the other apps in this monorepo.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
