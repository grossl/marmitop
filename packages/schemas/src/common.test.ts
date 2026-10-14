// covers FR-034, FR-045, FR-047, FR-095, FR-144
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import { z } from "zod";
import {
  apiErrorSchema,
  cepSchema,
  cnpjSchema,
  cpfCnpjSchema,
  cpfSchema,
  ibgeCodeSchema,
  isValidCnpj,
  isValidCpf,
  paginationQuerySchema,
  parseOrThrow,
  phoneSchema,
  ufSchema,
  zodErrorToDetails,
} from "./common";

describe("validators", () => {
  test("re-exports the CPF and CNPJ check-digit validators", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });
  test("cpfSchema strips punctuation and returns digits", () => {
    expect(cpfSchema.parse("111.444.777-35")).toBe("11144477735");
    expect(cpfSchema.safeParse("111.444.777-36").success).toBe(false);
    expect(cpfSchema.safeParse("123").success).toBe(false);
  });
  test("cnpjSchema", () => {
    expect(cnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181");
    expect(cnpjSchema.safeParse("11.222.333/0001-82").success).toBe(false);
  });
  test("cpfCnpjSchema accepts either, digits out", () => {
    expect(cpfCnpjSchema.parse("111.444.777-35")).toBe("11144477735");
    expect(cpfCnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181");
    expect(cpfCnpjSchema.safeParse("1234567890").success).toBe(false);
  });
  test("cepSchema: 8 digits, hyphen allowed on input", () => {
    expect(cepSchema.parse("01310-100")).toBe("01310100");
    expect(cepSchema.parse("01310100")).toBe("01310100");
    for (const bad of ["1310100", "013101000", "abcdefgh", ""]) expect(cepSchema.safeParse(bad).success).toBe(false);
  });
  test("ufSchema: one of 27 units, case-insensitive input, uppercase out", () => {
    expect(ufSchema.parse("sp")).toBe("SP");
    expect(ufSchema.parse("RJ")).toBe("RJ");
    expect(ufSchema.safeParse("XX").success).toBe(false);
    expect(ufSchema.safeParse("S").success).toBe(false);
  });
  test("ibgeCodeSchema: 7 digits", () => {
    expect(ibgeCodeSchema.parse("3550308")).toBe("3550308");
    expect(ibgeCodeSchema.safeParse("355030").success).toBe(false);
  });
  test("phoneSchema normalizes to E.164 (FR-047)", () => {
    expect(phoneSchema.parse("(11) 99999-0000")).toBe("+5511999990000");
    expect(phoneSchema.parse("+55 11 99999-0000")).toBe("+5511999990000");
    expect(phoneSchema.safeParse("123").success).toBe(false);
    expect(phoneSchema.safeParse("").success).toBe(false);
  });
});

describe("paginationQuerySchema (06.api-spec.md)", () => {
  test("defaults to 50, coerces strings, caps at 100", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ limit: "20", cursor: "abc" })).toEqual({ limit: 20, cursor: "abc" });
    expect(paginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});

describe("error envelope (FR-144)", () => {
  test("apiErrorSchema accepts the documented shape", () => {
    const body = {
      error: {
        code: "validation_failed" as const,
        message: "The request body is invalid.",
        details: [{ path: "items[0].menu_item_id", code: "item_unavailable", message: "x" }],
      },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
    expect(apiErrorSchema.safeParse({ error: { code: "nope", message: "x" } }).success).toBe(false);
    expect(apiErrorSchema.parse({ error: { code: "not_found", message: "x" } }).error.details).toBeUndefined();
  });
  test("zodErrorToDetails builds body-relative paths with array indexes", () => {
    const schema = z.object({ items: z.array(z.object({ qty: z.number().int().min(1) })), name: z.string().min(1) });
    const r = schema.safeParse({ items: [{ qty: 1 }, { qty: 0 }], name: "" });
    if (r.success) throw new Error("should fail");
    const details = zodErrorToDetails(r.error);
    expect(details.map((d) => d.path)).toEqual(["items[1].qty", "name"]);
    expect(details.every((d) => d.code.length > 0 && d.message.length > 0)).toBe(true);
  });
  test("parseOrThrow returns parsed data or throws a 422 AppError with field paths", () => {
    const schema = z.object({ qty: z.number().int().min(1) });
    expect(parseOrThrow(schema, { qty: 2 })).toEqual({ qty: 2 });
    try {
      parseOrThrow(schema, { qty: 0 });
      throw new Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("validation_failed");
      expect((e as AppError).httpStatus).toBe(422);
      expect((e as AppError).details?.[0]?.path).toBe("qty");
    }
  });
});
