import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silences Next's workspace-root inference warning: there's an unrelated
  // stray yarn.lock in the machine's home directory (outside this repo)
  // that Turbopack's auto-detection otherwise picks up instead of this
  // monorepo's actual root.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
