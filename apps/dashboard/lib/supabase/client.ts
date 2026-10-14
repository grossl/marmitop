"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

/**
 * Browser Supabase client with the user's session. Auth and Realtime only:
 * the `authenticated` role has `select` on orders, messages, and
 * conversations and nothing else (ADR-004, ADR-017).
 */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  if (!env.isSupabaseConfigured) {
    throw new Error("Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createBrowserClient(env.supabaseUrl as string, env.supabaseAnonKey as string);
}
