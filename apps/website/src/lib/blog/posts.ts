/**
 * The blog post registry: the single list `/blog`, `/blog/[slug]` and
 * `sitemap.ts` are all driven from.
 *
 * Two decisions here are not obvious from the code:
 *
 * 1. **The list is explicit, not a filesystem scan.** Adding a post means
 *    adding an import to this file. A `readdir` over `src/content/blog` would
 *    be IO, and IO in a module that both routes import is exactly what quietly
 *    drops a page out of the static shell. It would also depend on `content/`
 *    being traced into the serverless bundle, which is a separate thing to get
 *    wrong. Imports are resolved by the bundler at build time and have neither
 *    problem.
 *
 * 2. **Frontmatter is a module export, not YAML.** `@next/mdx` does not parse
 *    YAML frontmatter, but it does support plain module exports, which is what
 *    `export const meta = {...}` at the top of each post is. That costs zero
 *    extra dependencies (no `gray-matter`, no `remark-frontmatter`, no
 *    `remark-mdx-frontmatter`) and avoids Turbopack's restriction that remark
 *    plugins can only be passed by serialisable name.
 *
 * Validation happens at module scope, so a post with malformed `meta` throws
 * while this module is being evaluated and fails the build.
 */
import WelcomeToIssebyaHomes, {
  meta as welcomeToIssebyaHomesMeta,
} from "@/content/blog/welcome-to-issebya-homes.mdx";
import { assertUniqueSlugs, type BlogPost, sortPostsByDateDesc, toBlogPost } from "./schema";

const posts: BlogPost[] = [toBlogPost(welcomeToIssebyaHomesMeta, WelcomeToIssebyaHomes)];

assertUniqueSlugs(posts);

export const allPosts: BlogPost[] = sortPostsByDateDesc(posts);

export function getPostBySlug(slug: string): BlogPost | undefined {
  return allPosts.find((post) => post.slug === slug);
}
