/**
 * GitHub URLs for a pinned code reference. Each path segment is encoded on
 * its own, so `/` stays a separator while `[slug]`-style segments become
 * `%5B`/`%5D` (GitHub accepts both); `(main)` is left as-is by
 * `encodeURIComponent`.
 */

const REPO = "SBub/issebya-homes-ai-system";

type CodeLocation = { path: string; ref: string };

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function blobUrl({ path, ref }: CodeLocation): string {
  return `https://github.com/${REPO}/blob/${ref}/${encodePath(path)}`;
}

export function rawUrl({ path, ref }: CodeLocation): string {
  return `https://raw.githubusercontent.com/${REPO}/${ref}/${encodePath(path)}`;
}

export function pullUrl(pr: number): string {
  return `https://github.com/${REPO}/pull/${pr}`;
}
