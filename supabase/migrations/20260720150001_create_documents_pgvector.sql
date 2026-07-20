-- Ported from issebya-homes-website's
-- supabase/migrations/20260409200000_squashed_baseline.sql — only the
-- documents/match_documents/pgvector slice, which src/tools/search-property.ts
-- depends on. The rest of that squashed baseline (bookings, chat_logs,
-- channels, etc.) is that repo's own unrelated schema, not needed here.

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

CREATE OR REPLACE FUNCTION "public"."match_documents"(
  "query_embedding" "extensions"."vector",
  "match_count" integer DEFAULT 5,
  "match_threshold" double precision DEFAULT 0.7,
  "filter" "jsonb" DEFAULT '{}'::"jsonb"
) RETURNS TABLE(
  "id" bigint,
  "content" "text",
  "metadata" "jsonb",
  "similarity" double precision,
  "created_at" timestamp with time zone
)
LANGUAGE "plpgsql"
AS $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity,
    d.created_at
  from public.documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
    and (filter = '{}'::jsonb or d.metadata @> filter)
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_documents_updated_at"() RETURNS "trigger"
LANGUAGE "plpgsql"
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE TABLE IF NOT EXISTS "public"."documents" (
  "id" bigint NOT NULL,
  "content" "text" NOT NULL,
  "embedding" "extensions"."vector"(1536),
  "created_at" timestamp with time zone DEFAULT "now"(),
  "metadata" "jsonb" DEFAULT '{}'::"jsonb",
  "updated_at" timestamp with time zone DEFAULT "now"()
);

CREATE SEQUENCE IF NOT EXISTS "public"."documents_id_seq"
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE "public"."documents_id_seq" OWNED BY "public"."documents"."id";
ALTER TABLE ONLY "public"."documents" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."documents_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."documents" ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");

CREATE INDEX IF NOT EXISTS "idx_documents_embedding" ON "public"."documents" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops");
CREATE INDEX IF NOT EXISTS "idx_documents_metadata" ON "public"."documents" USING "gin" ("metadata");
CREATE INDEX IF NOT EXISTS "idx_documents_created_at" ON "public"."documents" USING "btree" ("created_at" DESC);

CREATE OR REPLACE TRIGGER "documents_updated_at"
  BEFORE UPDATE ON "public"."documents"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_documents_updated_at"();

ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous read access" ON "public"."documents" FOR SELECT TO "anon" USING (true);
