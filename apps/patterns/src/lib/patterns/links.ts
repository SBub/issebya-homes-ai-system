/**
 * GitHub URLs for a pinned code reference. Each path segment is encoded on
 * its own, so `/` stays a separator while `[slug]`-style segments become
 * `%5B`/`%5D` (GitHub accepts both); `(main)` is left as-is by
 * `encodeURIComponent`. The repo defaults to this one; a doc whose proof code
 * lives elsewhere passes its frontmatter `repo`.
 */

export const DEFAULT_REPO = "SBub/issebya-homes-ai-system";

type CodeLocation = { path: string; ref: string; repo?: string | undefined };

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function blobUrl({ path, ref, repo = DEFAULT_REPO }: CodeLocation): string {
  return `https://github.com/${repo}/blob/${ref}/${encodePath(path)}`;
}

export function rawUrl({ path, ref, repo = DEFAULT_REPO }: CodeLocation): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${encodePath(path)}`;
}

export function pullUrl(pr: number, repo = DEFAULT_REPO): string {
  return `https://github.com/${repo}/pull/${pr}`;
}
