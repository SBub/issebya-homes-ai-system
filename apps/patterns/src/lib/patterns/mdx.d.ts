// remark-mdx-frontmatter adds a `frontmatter` export (the doc's parsed YAML) to
// every `.mdx` module; @types/mdx only declares the default export. `unknown`
// on purpose: the registry validates it with the schema before anything reads it.
declare module "*.mdx" {
  export const frontmatter: unknown;
}
