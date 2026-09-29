/**
 * `yarn workspace patterns check-links`: fetches every `code` entry of every
 * doc from raw.githubusercontent.com at its pinned ref and exits 1 unless all
 * return 200. A script, not a test, so `test` stays offline.
 */
import { rawUrl } from "../src/lib/patterns/links";
import { readContent } from "../src/lib/patterns/read-content";

const entries = readContent().flatMap((doc) => doc.meta.code);

let failures = 0;
for (const entry of entries) {
  const res = await fetch(rawUrl(entry), { method: "GET" });
  if (res.status !== 200) failures += 1;
  console.log(`${res.status} ${entry.path}@${entry.ref.slice(0, 7)}`);
}

if (failures > 0) {
  console.error(`${failures} of ${entries.length} code links failed`);
  process.exit(1);
}
console.log(`all ${entries.length} code links returned 200`);
