import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { HOME_PATH } from "@/lib/nav";

// Next 16 proxy (formerly middleware). Refreshes the Supabase session cookie
// on every navigation and redirects unauthenticated requests to /login
// (FR-003, ADR-005). This is the optimistic check; pages and actions verify
// the user again on the server (lib/server/session.ts).

const PUBLIC_PATHS = new Set(["/login"]);
// The public menu page needs no session (ADR-030, FR-220).
const PUBLIC_PREFIXES = ["/m/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });
  // Unconfigured: the pages render the setup notice.
  if (!env.isSupabaseConfigured) return response;

  const supabase = createServerClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = HOME_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
