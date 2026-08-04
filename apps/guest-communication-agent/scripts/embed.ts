/**
 * Embedding script: chunks the property knowledge base's markdown files by
 * `##` headers, embeds via OpenRouter, and upserts into this app's
 * `documents` pgvector table.
 *
 * Usage: yarn embed (from apps/guest-communication-agent/)
 *
 * Ported from issebya-homes-website's
 * packages/agent-concierge/scripts/embed.ts (that package was later removed
 * from that repo; this port survives at
 * .claude/worktrees/agent-a491dc5e9fde14139/packages/agent-concierge/scripts/embed.ts
 * in that repo, read-only reference). The chunking logic (chunkByHeaders) is
 * unchanged from that original — it's proven against the real content.
 *
 * Three deliberate differences from the original:
 *
 * 1. Client/model wiring matches this app's own conventions rather than the
 *    source repo's: `createAdminClient` from "@/lib/supabase" (this app's
 *    own inlined factory, not `@issebya/shared/supabase` — this monorepo has
 *    no packages/* workspace), and the OpenRouter-as-OpenAI-compatible-
 *    endpoint pattern from src/agent/tools/property-question.ts and
 *    src/app/api/owner-nudges/[id]/answer/route.ts (`createOpenAI` from
 *    "@ai-sdk/openai" pointed at OpenRouter's base URL) instead of a
 *    dedicated `../src/openrouter` module (this app has no such module).
 *
 * 2. Real diff-based upsert instead of "delete everything, reinsert
 *    everything" every run. The original computed a `content_hash` per
 *    chunk but never used it to skip unchanged work — it unconditionally
 *    ran `DELETE FROM documents WHERE id != 0` followed by a full
 *    re-insert + re-embed + re-categorize of every chunk, on every run.
 *    This version:
 *      - Parses every .md file into the desired chunk list (cheap, local,
 *        no API calls — always done in full).
 *      - Reads only the existing `documents` rows whose `metadata->>source`
 *        is one of the knowledge-base filenames being processed here (see
 *        `KNOWLEDGE_BASE_SOURCES` below) — scoped so this script never
 *        touches, reads as relevant, or deletes rows from other sources,
 *        in particular the `owner_nudge_answer` rows written by
 *        POST /api/owner-nudges/[id]/answer (src/app/api/owner-nudges/[id]/answer/route.ts).
 *      - Diffs desired vs. existing keyed on `(source, section)` — the
 *        stable identity for a chunk, since `content_hash` changes
 *        whenever the content does and so can't be the identity key
 *        itself:
 *          - Not in the existing map -> new: embed + insert.
 *          - In the map with a matching content_hash -> unchanged: skip
 *            entirely (no embedding call, no DB write).
 *          - In the map with a different content_hash -> changed: embed +
 *            update that row by id.
 *          - Existing row (within the source-scoped set) whose
 *            (source, section) is no longer desired -> deleted (content
 *            was removed from the source file).
 *      - Logs a summary of skipped / embedded (new + changed) / deleted
 *        counts so the efficiency fix is directly verifiable from output.
 *
 * 3. No `type`/`topics` categorization. The original ran a second LLM call
 *    per new/changed chunk (GPT-4o-mini via OpenRouter) to guess a `type`
 *    enum and 1-3 `topics` tags, stored alongside `source`/`section` in
 *    `metadata`. Nothing in this app ever reads those fields:
 *    src/agent/tools/property-question.ts's `runAnswerPropertyQuestion`
 *    always calls `match_documents` with `filter: {}` (unfiltered) —
 *    deliberately, per that function's own header comment, after a confirmed
 *    bug in issebya-homes-website (commit 04e1f91) where a `type`-based
 *    filter caused real false negatives: the model's guessed category didn't
 *    match how a chunk was actually classified, silently excluding relevant
 *    content from an otherwise-good match. That's the same lesson this file
 *    is now acting on from the producing side: if nothing consumes `type`/
 *    `topics`, don't spend an API call generating them. `ChunkMetadata` is
 *    now just `{ source, section, content_hash }`, matching what
 *    property-question.ts's `DocumentMetadata` type declares. This also
 *    means one fewer API call per new/changed chunk (no GPT-4o-mini round
 *    trip), so embedding runs faster.
 *
 * Requires in .env: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { createAdminClient } from "../src/lib/supabase";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWLEDGE_BASE_DIR = join(__dirname, "../knowledge-base");

// Same OpenRouter-as-OpenAI-compatible-endpoint setup as
// ../src/agent/tools/property-question.ts and
// ../src/app/api/owner-nudges/[id]/answer/route.ts.
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const supabase = createAdminClient();

type Chunk = {
  content: string;
  source: string;
  section: string;
};

type ChunkMetadata = {
  source: string;
  section: string;
  content_hash: string;
};

type ExistingRow = {
  id: number;
  metadata: ChunkMetadata;
};

/**
 * Split a markdown file into chunks by ## headers.
 */
function chunkByHeaders(content: string, source: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentSection && currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text.length > 0) {
          chunks.push({
            content: `${currentSection}\n\n${text}`,
            source,
            section: currentSection.replace("## ", ""),
          });
        }
      }
      currentSection = line;
      currentContent = [];
    } else if (line.startsWith("# ") && !currentSection) {
      currentSection = line;
      currentContent = [];
    } else if (line.startsWith("<!--")) {
      // skip comments
    } else {
      currentContent.push(line);
    }
  }

  if (currentSection && currentContent.length > 0) {
    const text = currentContent.join("\n").trim();
    if (text.length > 0) {
      chunks.push({
        content: `${currentSection}\n\n${text}`,
        source,
        section: currentSection.replace(/^#{1,2} /, ""),
      });
    }
  }

  return chunks;
}

/**
 * Compute SHA256 hash of content for incremental re-embedding.
 */
function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Embed a batch of texts via OpenRouter using the AI SDK.
 */
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const { embeddings } = await embedMany({
    model: openrouter.embedding("openai/text-embedding-3-small"),
    values: texts,
  });
  return embeddings;
}

function keyFor(source: string, section: string): string {
  return `${source} ${section}`;
}

async function main() {
  console.log(`Reading knowledge base from ${KNOWLEDGE_BASE_DIR}...`);

  const files = readdirSync(KNOWLEDGE_BASE_DIR).filter((f) => f.endsWith(".md"));
  console.log(`Found ${files.length} files: ${files.join(", ")}`);

  // Chunk all files (cheap, local, no API calls).
  const desiredChunks: Chunk[] = [];
  for (const file of files) {
    const content = readFileSync(join(KNOWLEDGE_BASE_DIR, file), "utf-8");
    const chunks = chunkByHeaders(content, file);
    console.log(`  ${file}: ${chunks.length} chunks`);
    desiredChunks.push(...chunks);
  }
  console.log(`\nTotal desired chunks: ${desiredChunks.length}`);

  // Check the documents table exists.
  const { error: tableCheck } = await supabase.from("documents").select("id").limit(1);
  if (tableCheck) {
    console.error("Documents table not found. Apply migrations first:");
    console.error("  yarn supabase:reset");
    process.exit(1);
  }

  // Load only the existing rows for the sources we're about to process —
  // never touch rows from other sources (e.g. owner_nudge_answer).
  const { data: existingData, error: selectError } = await supabase
    .from("documents")
    .select("id, metadata")
    .in("metadata->>source", files);

  if (selectError) {
    console.error("Failed to read existing documents:", selectError.message);
    process.exit(1);
  }

  const existingRows = (existingData ?? []) as ExistingRow[];
  const existingByKey = new Map<string, ExistingRow>();
  for (const row of existingRows) {
    existingByKey.set(keyFor(row.metadata.source, row.metadata.section), row);
  }

  // Diff desired chunks against existing rows.
  type PendingInsert = { chunk: Chunk; hash: string };
  type PendingUpdate = { id: number; chunk: Chunk; hash: string };

  const toInsert: PendingInsert[] = [];
  const toUpdate: PendingUpdate[] = [];
  let skipped = 0;

  const desiredKeys = new Set<string>();
  for (const chunk of desiredChunks) {
    const key = keyFor(chunk.source, chunk.section);
    desiredKeys.add(key);
    const hash = contentHash(chunk.content);
    const existing = existingByKey.get(key);

    if (!existing) {
      toInsert.push({ chunk, hash });
    } else if (existing.metadata.content_hash === hash) {
      skipped += 1;
    } else {
      toUpdate.push({ id: existing.id, chunk, hash });
    }
  }

  const toDelete = existingRows.filter(
    (row) => !desiredKeys.has(keyFor(row.metadata.source, row.metadata.section)),
  );

  console.log(
    `\nDiff: ${toInsert.length} new, ${toUpdate.length} changed, ${skipped} unchanged (skipped), ${toDelete.length} to delete`,
  );

  // Embed only new/changed chunks.
  const toEmbed = [...toInsert, ...toUpdate];
  if (toEmbed.length > 0) {
    console.log(`\nEmbedding ${toEmbed.length} chunk(s)...`);
  }
  const texts = toEmbed.map((c) => c.chunk.content);
  const embeddings = await embedTexts(texts);

  // Apply inserts.
  const insertCount = toInsert.length;
  if (insertCount > 0) {
    const insertRows = toInsert.map((pending, i) => {
      const metadata: ChunkMetadata = {
        source: pending.chunk.source,
        section: pending.chunk.section,
        content_hash: pending.hash,
      };
      return {
        content: pending.chunk.content,
        metadata,
        embedding: JSON.stringify(embeddings[i]),
      };
    });

    const { error: insertError } = await supabase.from("documents").insert(insertRows);
    if (insertError) {
      console.error("Failed to insert documents:", insertError.message);
      process.exit(1);
    }
  }

  // Apply updates (offset into embeddings after the inserts).
  for (let i = 0; i < toUpdate.length; i++) {
    const pending = toUpdate[i];
    const embedding = embeddings[insertCount + i];
    const metadata: ChunkMetadata = {
      source: pending.chunk.source,
      section: pending.chunk.section,
      content_hash: pending.hash,
    };

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        content: pending.chunk.content,
        metadata,
        embedding: JSON.stringify(embedding),
      })
      .eq("id", pending.id);

    if (updateError) {
      console.error(`Failed to update document id=${pending.id}:`, updateError.message);
      process.exit(1);
    }
  }

  // Apply deletes.
  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("documents")
      .delete()
      .in(
        "id",
        toDelete.map((r) => r.id),
      );
    if (deleteError) {
      console.error("Failed to delete stale documents:", deleteError.message);
      process.exit(1);
    }
  }

  console.log("\nDone.");
  console.log("Summary:");
  console.log(`  new:       ${toInsert.length}`);
  console.log(`  changed:   ${toUpdate.length}`);
  console.log(`  unchanged: ${skipped} (skipped — no embedding call)`);
  console.log(`  deleted:   ${toDelete.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
