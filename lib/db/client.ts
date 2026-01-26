import { createClient } from '@supabase/supabase-js';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable');
}

// Supabase client configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Create Supabase client with service role key for backend operations
// This bypasses RLS (Row Level Security) for server-side operations
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    // NOTE: We keep default schema as 'public' but the SQL schema (`Doc/mvp.sql`)
    // uses multiple schemas (login, master, property, business, user_activity).
    // Query modules should use the schema-specific clients below.
    schema: 'public',
  },
});

// Schema-scoped clients matching `Doc/mvp.sql`
export const dbLogin = supabase.schema('login');
export const dbMaster = supabase.schema('master');
export const dbProperty = supabase.schema('property');
export const dbBusiness = supabase.schema('business');
export const dbUserActivity = supabase.schema('user_activity');

// Direct PostgreSQL client for raw queries (if needed)
// Note: Supabase JS client handles connection pooling automatically
export default supabase;




