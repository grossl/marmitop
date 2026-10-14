// covers 06.api-spec.md "Pagination", FR-144 (invalid cursor → validation_failed)
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";

import { decodeKeysetCursor, encodeKeysetCursor, pageOf } from "./cursor";

const ID = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";

describe("keyset cursor", () => {
  test("round-trips created_at and id as an opaque string", () => {
    const at = new Date("2026-10-13T12:00:00.123Z");
    const cursor = encodeKeysetCursor({ createdAt: at, id: ID });
    expect(cursor).not.toContain(ID);
    expect(decodeKeysetCursor(cursor)).toEqual({ createdAt: at, id: ID });
  });

  test("undefined decodes to null (first page)", () => {
    expect(decodeKeysetCursor(undefined)).toBeNull();
  });

  test("garbage is validation_failed on the cursor path", () => {
    for (const bad of ["xyz", encodeURIComponent("{}"), Buffer.from('{"c":"nope","i":"x"}').toString("base64url")]) {
      const e = (() => {
        try {
          decodeKeysetCursor(bad);
        } catch (x) {
          return x;
        }
      })();
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("validation_failed");
      expect((e as AppError).details?.[0]?.path).toBe("cursor");
    }
  });
});

describe("pageOf", () => {
  const rows = [1, 2, 3].map((n) => ({
    id: `0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f2${n}`,
    created_at: new Date(2026, 0, n),
  }));

  test("limit + 1 rows: next_cursor points at the last returned row", () => {
    const page = pageOf(rows, 2, (r) => r);
    expect(page.data).toEqual([rows[0]!, rows[1]!]);
    expect(decodeKeysetCursor(page.next_cursor ?? undefined)).toEqual({
      createdAt: rows[1]!.created_at,
      id: rows[1]!.id,
    });
  });

  test("the last page has next_cursor null", () => {
    expect(pageOf(rows, 3, (r) => r).next_cursor).toBeNull();
  });
});
