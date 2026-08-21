-- Squashed baseline migration (2026-04-09)
-- Replaces 34 intermediate migrations with the current final schema.
-- Uses IF NOT EXISTS and DO/EXCEPTION blocks throughout so running against
-- prod (which may already have some objects) is safe.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

-- Functions

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

-- Tables

CREATE TABLE IF NOT EXISTS "public"."bookings" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "access_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
  "room_type" "text" NOT NULL,
  "check_in" "date" NOT NULL,
  "check_out" "date" NOT NULL,
  "nights" integer NOT NULL,
  "person_count" integer NOT NULL,
  "base_price" numeric(10,2) NOT NULL,
  "tourist_tax" numeric(10,2) NOT NULL,
  "total_amount" numeric(10,2) NOT NULL,
  "email" "text" NOT NULL,
  "stripe_session_id" "text" NOT NULL,
  "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "payment_intent" "text",
  CONSTRAINT "bookings_room_type_check" CHECK (("room_type" = ANY (ARRAY['room1'::"text", 'room2'::"text"]))),
  CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'cancelled'::"text"])))
);

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

CREATE TABLE IF NOT EXISTS "public"."chat_logs" (
  "id" bigint NOT NULL,
  "session_id" "text" NOT NULL,
  "role" "text" NOT NULL,
  "content" "text",
  "tool_name" "text",
  "tool_input" "text",
  "tool_output" "text",
  "tokens_used" integer,
  "latency_ms" integer,
  "created_at" timestamp with time zone DEFAULT "now"(),
  "channel" "text" DEFAULT 'guest'::"text" NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS "public"."chat_logs_id_seq"
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE "public"."chat_logs_id_seq" OWNED BY "public"."chat_logs"."id";
ALTER TABLE ONLY "public"."chat_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."chat_logs_id_seq"'::"regclass");

CREATE TABLE IF NOT EXISTS "public"."channels" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "platform" "text" NOT NULL,
  "name" "text" NOT NULL,
  "description" "text" NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "figma_board_ref" "text",
  CONSTRAINT "channels_platform_check" CHECK (("platform" = ANY (ARRAY['whatsapp'::"text", 'instagram'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."outreach_history" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "channel_id" "uuid" NOT NULL,
  "gap_dates" "jsonb" NOT NULL,
  "week_of" "date" NOT NULL,
  "room" "text",
  "status" "text" DEFAULT 'draft'::"text" NOT NULL,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "figma_frame_ref" "text",
  CONSTRAINT "outreach_history_room_check" CHECK (("room" = ANY (ARRAY['room1'::"text", 'room2'::"text"]))),
  CONSTRAINT "outreach_history_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'posted'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."reference_guides" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "type" "text" NOT NULL,
  "scope" "text",
  "summary" "text",
  "examples" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
  "logs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "channel_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
  CONSTRAINT "reference_guides_type_check" CHECK (("type" = ANY (ARRAY['copy'::"text", 'visual'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."knowledge_gap_topics" (
  "id" bigint NOT NULL,
  "topic" "text" NOT NULL,
  "ticket_type" "text" NOT NULL,
  "linear_ticket_id" "text",
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "examples" "jsonb"[] DEFAULT '{}'::"jsonb"[] NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT "now"(),
  "last_seen_at" timestamp with time zone DEFAULT "now"(),
  "resolved_at" timestamp with time zone,
  CONSTRAINT "knowledge_gap_topics_ticket_type_check" CHECK (("ticket_type" = ANY (ARRAY['knowledge-gap'::"text", 'retrieval-issue'::"text"])))
);

CREATE SEQUENCE IF NOT EXISTS "public"."knowledge_gap_topics_id_seq"
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE "public"."knowledge_gap_topics_id_seq" OWNED BY "public"."knowledge_gap_topics"."id";
ALTER TABLE ONLY "public"."knowledge_gap_topics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."knowledge_gap_topics_id_seq"'::"regclass");

CREATE TABLE IF NOT EXISTS "public"."processed_sessions" (
  "session_id" "text" NOT NULL,
  "processed_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."admin_logs" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "session_id" "text" NOT NULL,
  "tool_name" "text" NOT NULL,
  "tool_input" "text",
  "tool_output" "text",
  "created_at" timestamp with time zone DEFAULT "now"()
);

-- Primary keys & unique constraints

DO $$ BEGIN
  ALTER TABLE ONLY "public"."bookings" ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."bookings" ADD CONSTRAINT "bookings_access_token_key" UNIQUE ("access_token");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."bookings" ADD CONSTRAINT "bookings_stripe_session_id_key" UNIQUE ("stripe_session_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."documents" ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."chat_logs" ADD CONSTRAINT "chat_logs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."channels" ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."outreach_history" ADD CONSTRAINT "outreach_history_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."reference_guides" ADD CONSTRAINT "reference_guides_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."knowledge_gap_topics" ADD CONSTRAINT "knowledge_gap_topics_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."knowledge_gap_topics" ADD CONSTRAINT "knowledge_gap_topics_linear_ticket_id_key" UNIQUE ("linear_ticket_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."processed_sessions" ADD CONSTRAINT "processed_sessions_pkey" PRIMARY KEY ("session_id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "public"."admin_logs" ADD CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

-- Foreign keys

DO $$ BEGIN
  ALTER TABLE ONLY "public"."outreach_history"
    ADD CONSTRAINT "outreach_history_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes

CREATE INDEX IF NOT EXISTS "idx_documents_embedding" ON "public"."documents" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops");
CREATE INDEX IF NOT EXISTS "idx_documents_metadata" ON "public"."documents" USING "gin" ("metadata");
CREATE INDEX IF NOT EXISTS "idx_documents_created_at" ON "public"."documents" USING "btree" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_chat_logs_session" ON "public"."chat_logs" USING "btree" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_chat_logs_channel" ON "public"."chat_logs" USING "btree" ("channel");

CREATE INDEX IF NOT EXISTS "idx_outreach_channel" ON "public"."outreach_history" USING "btree" ("channel_id");
CREATE INDEX IF NOT EXISTS "idx_outreach_status" ON "public"."outreach_history" USING "btree" ("status");
CREATE INDEX IF NOT EXISTS "idx_outreach_week" ON "public"."outreach_history" USING "btree" ("week_of");
CREATE INDEX IF NOT EXISTS "idx_outreach_channel_status_week" ON "public"."outreach_history" USING "btree" ("channel_id", "status", "week_of");

CREATE INDEX IF NOT EXISTS "idx_reference_guides_channel_ids" ON "public"."reference_guides" USING "gin" ("channel_ids");

CREATE INDEX IF NOT EXISTS "idx_knowledge_gap_topics_type" ON "public"."knowledge_gap_topics" USING "btree" ("ticket_type");
CREATE INDEX IF NOT EXISTS "idx_knowledge_gap_topics_resolved" ON "public"."knowledge_gap_topics" USING "btree" ("resolved_at") WHERE ("resolved_at" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_admin_logs_session_id" ON "public"."admin_logs" USING "btree" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_admin_logs_created_at" ON "public"."admin_logs" USING "btree" ("created_at" DESC);

-- Triggers

CREATE OR REPLACE TRIGGER "documents_updated_at"
  BEFORE UPDATE ON "public"."documents"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_documents_updated_at"();

-- RLS

ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."chat_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."outreach_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reference_guides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."knowledge_gap_topics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."processed_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."admin_logs" ENABLE ROW LEVEL SECURITY;

-- RLS Policies

DO $$ BEGIN
  CREATE POLICY "Allow public select" ON "public"."bookings" FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow service role insert" ON "public"."bookings" FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow service role update" ON "public"."bookings" FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Allow anonymous read access" ON "public"."documents" FOR SELECT TO "anon" USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role insert" ON "public"."chat_logs" FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated read" ON "public"."chat_logs" FOR SELECT TO "authenticated" USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access" ON "public"."channels" USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access" ON "public"."outreach_history" USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access" ON "public"."reference_guides" USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role write" ON "public"."knowledge_gap_topics" WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated read" ON "public"."knowledge_gap_topics" FOR SELECT TO "authenticated" USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role insert" ON "public"."processed_sessions" FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated read" ON "public"."processed_sessions" FOR SELECT TO "authenticated" USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access" ON "public"."admin_logs" TO "service_role" USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
