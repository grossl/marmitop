import "server-only";

import { resolveUserContext, type UserContext } from "@mt/http";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { canOpen, type Section } from "@/lib/nav";
import { requireDeps } from "@/lib/server/deps";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Session → restaurant → role, resolved on the server for every request
// (ADR-004, ADR-005, FR-008). The browser sends only its session cookie.
// `getUser()` asks Supabase Auth to verify the JWT; the cookie alone is not
// trusted. `cache` makes it one lookup per request.

export interface SessionUser {
  readonly id: string;
  readonly email: string | undefined;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
});

export interface Session {
  readonly user: SessionUser;
  /** `null` when the user belongs to no restaurant. */
  readonly ctx: UserContext | null;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const ctx = await resolveUserContext(requireDeps(), user.id);
  return { user, ctx };
});

/** A signed-in member, or a redirect to /login. */
export async function requireMember(): Promise<{ user: SessionUser; ctx: UserContext } | { user: SessionUser; ctx: null }> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Page-level role gate (FR-005). A screen the role cannot open answers 404, so it is not even confirmed. */
export async function requireScreen(section: Section): Promise<UserContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.ctx || !canOpen(session.ctx.role, section)) notFound();
  return session.ctx;
}
