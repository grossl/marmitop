// Keyset pagination for the public API (06.api-spec.md "Pagination"): lists sort by
// `created_at desc, id desc`. The cursor is the last returned row's (created_at, id),
// base64url JSON. It is opaque to clients; a bad one is `422 validation_failed`.

import { AppError } from "@mt/core";

export interface KeysetCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface Page<T> {
  readonly data: T[];
  readonly next_cursor: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = () =>
  new AppError("validation_failed", "The cursor is invalid.", {
    details: [{ path: "cursor", code: "invalid_cursor", message: "Cursor inválido." }],
  });

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id })).toString("base64url");
}

export function decodeKeysetCursor(value: string | undefined): KeysetCursor | null {
  if (value === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const c = (parsed as { c?: unknown } | null)?.c;
  const i = (parsed as { i?: unknown } | null)?.i;
  if (typeof c !== "string" || typeof i !== "string" || !UUID.test(i)) throw invalid();
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) throw invalid();
  return { createdAt, id: i };
}

/** `rows` holds up to `limit + 1` rows in list order; the extra row only signals a next page. */
export function pageOf<R extends { id: string; created_at: Date }, T>(
  rows: readonly R[],
  limit: number,
  map: (row: R) => T,
): Page<T> {
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    data: shown.map(map),
    next_cursor: rows.length > limit && last ? encodeKeysetCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}
