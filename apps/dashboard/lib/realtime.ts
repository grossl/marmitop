"use client";

import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Live updates (ADR-004). The browser subscribes with the user's session, so
// Realtime evaluates the `authenticated` select policies and only this
// restaurant's rows arrive. The `restaurant_id` filter narrows traffic; it is
// not the security boundary (RLS is). On an event, refresh data through a
// Server Action or `router.refresh()` — never trust the payload as the source
// of truth.

/**
 * The tables published to `supabase_realtime` (05.data-model.md, ADR-017). `order_invoices`
 * arrives with its status columns only (migration 0017).
 */
export type RealtimeTable = "orders" | "messages" | "conversations" | "order_invoices";

export type RealtimeChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

export function useRealtimeTable(
  table: RealtimeTable,
  restaurantId: string | null | undefined,
  onChange: (change: RealtimeChange) => void,
): void {
  // Keep the latest callback without resubscribing on every render.
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!restaurantId) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    const channel = supabase.channel(`mt:${table}:${restaurantId}`);

    void (async () => {
      // Realtime authorizes with the access token; set it before subscribing.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `restaurant_id=eq.${restaurantId}` },
          (payload) => handler.current(payload as RealtimeChange),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [table, restaurantId]);
}
