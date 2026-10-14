import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";

/** Supabase client for Server Components and Server Actions: Auth only (ADR-004). Null when unconfigured. */
export async function createSupabaseServerClient() {
  const env = getPublicEnv();
  if (!env.isSupabaseConfigured) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // A Server Component cannot set cookies. The proxy refreshes the session on navigation.
        }
      },
    },
  });
}
