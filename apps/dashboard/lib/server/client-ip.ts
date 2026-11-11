// The visitor's IP address for the per-visitor checkout limit (FR-235). Vercel sets `x-real-ip`
// and the first `x-forwarded-for` entry itself, so a client cannot choose them there. Behind
// another host, its edge proxy must overwrite these headers (11.operations.md). Null when
// neither header is present: the restaurant limit still applies.

const MAX_LENGTH = 64;

export function clientIpFrom(headers: Pick<Headers, "get">): string | null {
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value && value.length <= MAX_LENGTH) return value;
  }
  return null;
}
