import path from "node:path";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
  },
  cacheComponents: true,
};

// Pattern docs are `.mdx` modules imported by the generated manifest, not
// routed `page.mdx` files, so `pageExtensions` is left alone.
//
// Every plugin is passed by string name with JSON-serialisable options. Next 16
// builds with Turbopack, which cannot serialise plugin functions across to its
// loader, so importing a plugin here and passing the function would break the
// build. `remark-frontmatter` + `remark-mdx-frontmatter` turn each doc's YAML
// frontmatter into a `frontmatter` export; `rehype-pretty-code` (with its
// `shiki` peer) highlights code blocks at build time, so highlighted code is
// static HTML and costs no client JavaScript.
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-frontmatter", ["remark-mdx-frontmatter", { name: "frontmatter" }]],
    rehypePlugins: [["rehype-pretty-code", { theme: "github-light" }]],
  },
});

export default withMDX(nextConfig);
