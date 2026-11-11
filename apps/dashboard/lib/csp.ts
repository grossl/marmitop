// The dashboard Content-Security-Policy (07.security.md "Transport"). The proxy builds it per
// request with a fresh nonce. Next.js reads the nonce from the request's CSP header and puts it
// on its own scripts; the root layout passes it to the next-themes script. 'strict-dynamic' lets
// those scripts load the chunks and the analytics script they insert.
//
// Styles keep 'unsafe-inline': Next, Radix, and Recharts set inline styles, and a style cannot
// run code. Images and connections allow the Supabase project for menu images, Auth, and Realtime.

export interface CspOptions {
  readonly nonce: string;
  /** `NEXT_PUBLIC_SUPABASE_URL`; undefined before setup. */
  readonly supabaseUrl: string | undefined;
  /** `next dev`: React needs eval for its debug tooling, and HMR uses a websocket. */
  readonly dev: boolean;
}

function supabaseOrigins(url: string | undefined): { http: string[]; ws: string[] } {
  if (!url) return { http: [], ws: [] };
  try {
    const parsed = new URL(url);
    const wsScheme = parsed.protocol === "https:" ? "wss:" : "ws:";
    return { http: [parsed.origin], ws: [`${wsScheme}//${parsed.host}`] };
  } catch {
    return { http: [], ws: [] };
  }
}

export function buildCsp({ nonce, supabaseUrl, dev }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...supabase.http]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...supabase.http, ...supabase.ws, ...(dev ? ["ws:"] : [])]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** 16 random bytes, base64: a fresh nonce for one response. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
