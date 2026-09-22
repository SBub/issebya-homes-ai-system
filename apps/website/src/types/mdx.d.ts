// Augments the `*.mdx` module declaration that `@types/mdx` provides, which
// types only the default export. Every blog post additionally declares its
// frontmatter as `export const meta = {...}` (the frontmatter mechanism
// `@next/mdx` supports natively), and TypeScript cannot infer the shape of an
// export it never compiles.
//
// `unknown` rather than a `BlogPostMeta` shape is deliberate: the contract is
// enforced at runtime by `postMetaSchema` in `src/lib/blog/schema.ts`, so a
// malformed post fails the build with a zod message. Typing it here would let
// a post assert a shape it does not have and lose that guarantee.
declare module "*.mdx" {
  export const meta: unknown;
}
