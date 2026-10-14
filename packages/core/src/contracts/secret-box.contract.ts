// Contract suite for SecretBox (ADR-012, NFR-010).

import { describe, expect, test } from "bun:test";
import { AppError } from "../errors";
import type { SecretBox, SecretContext } from "../ports/secret-box";

export function secretBoxContract(name: string, create: () => SecretBox): void {
  const ctx: SecretContext = { restaurantId: "r1", secretId: "s1", kind: "webnf_api_key" };
  describe(`SecretBox contract: ${name}`, () => {
    test("open returns what seal stored, and last4 is the tail of the plaintext", async () => {
      const box = create();
      const sealed = await box.seal("nfk_test_abcdef123456", ctx);
      expect(sealed.last4).toBe("3456");
      expect(await box.open(sealed, ctx)).toBe("nfk_test_abcdef123456");
    });

    test("a different restaurant, secret id, or kind cannot open it", async () => {
      const box = create();
      const sealed = await box.seal("value-1234", ctx);
      for (const other of [
        { ...ctx, restaurantId: "r2" },
        { ...ctx, secretId: "s2" },
        { ...ctx, kind: "uatis_api_key" as const },
      ]) {
        await expect(box.open(sealed, other)).rejects.toBeInstanceOf(AppError);
      }
    });
  });
}
