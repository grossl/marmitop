// The public half of the dashboard environment. The proxy and Client
// Components import this file, so it reads `NEXT_PUBLIC_*` only and never
// throws: a missing variable becomes a setup notice, not a crash (web-nf
// pattern). Server variables live in `lib/server/env.ts`.

export interface PublicEnvStatus {
  readonly supabaseUrl: string | undefined;
  readonly supabaseAnonKey: string | undefined;
  readonly isSupabaseConfigured: boolean;
  readonly missing: string[];
}

export function getPublicEnv(): PublicEnvStatus {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { supabaseUrl, supabaseAnonKey, isSupabaseConfigured: missing.length === 0, missing };
}
