import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same Turbopack workspace-root fix as apps/finance and apps/social-media.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
