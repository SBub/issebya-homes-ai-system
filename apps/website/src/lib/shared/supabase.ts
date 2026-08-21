import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the anon key for guest operations.
 * This client is subject to Row Level Security (RLS) policies.
 */
export function createClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing environment variable: SUPABASE_URL");
  }

  if (!supabaseAnonKey) {
    throw new Error("Missing environment variable: SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Creates a Supabase client using the service role key for admin operations.
 * This client bypasses Row Level Security (RLS) policies.
 *
 * WARNING: Only use this in secure server-side contexts. Never expose the
 * service role key to the client.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing environment variable: SUPABASE_URL");
  }

  if (!supabaseServiceRoleKey) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
