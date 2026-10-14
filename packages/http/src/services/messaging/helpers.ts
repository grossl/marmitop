// Pure helpers shared by the messaging services (FR-010, FR-011, FR-041).

/** `conversations.last_message_preview` holds at most 120 characters (05.data-model.md). */
export const PREVIEW_MAX = 120;

/** One line, trimmed, cut to 120 characters. */
export function previewOf(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length <= PREVIEW_MAX ? oneLine : `${oneLine.slice(0, PREVIEW_MAX - 1)}…`;
}

/** Escapes `%`, `_`, and `\` so a search term matches literally in `ilike`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The `ilike` pattern for a search term, or `null` for a blank term (no filter). */
export function likePattern(term: string | undefined): string | null {
  const t = term?.trim();
  return t ? `%${escapeLike(t)}%` : null;
}

/** Cursors are opaque offsets: `base64url("o:<n>")`. A bad cursor reads as the first page. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^o:(\d{1,9})$/.exec(Buffer.from(cursor, "base64url").toString());
  return match?.[1] ? Number(match[1]) : 0;
}
