// covers FR-034, FR-045, FR-047, FR-122, FR-125
import { describe, expect, test } from "bun:test";
import {
  digitsOnly,
  isValidCep,
  isValidCnpj,
  isValidCpf,
  isValidIbgeCode,
  isValidUf,
  normalizePhoneE164,
  UF_CODES,
} from "./br-documents";

describe("CPF", () => {
  test("accepts valid numbers with or without punctuation", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });
  test("rejects wrong check digits, wrong length, repeated digits", () => {
    expect(isValidCpf("111.444.777-36")).toBe(false);
    expect(isValidCpf("1114447773")).toBe(false);
    expect(isValidCpf("111444777350")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
});

describe("CNPJ", () => {
  test("accepts valid numbers with or without punctuation", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("04.252.011/0001-10")).toBe(true);
  });
  test("rejects wrong check digits, length, repeated digits", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
});

describe("CEP, UF, IBGE", () => {
  test("CEP is exactly 8 digits", () => {
    expect(isValidCep("01310100")).toBe(true);
    expect(isValidCep("01310-100")).toBe(false); // stored digits only; schemas strip first
    expect(isValidCep("1310100")).toBe(false);
    expect(isValidCep("013101000")).toBe(false);
  });
  test("UF is one of the 27 federative units, uppercase", () => {
    expect(UF_CODES.length).toBe(27);
    for (const uf of ["SP", "RJ", "DF", "AC", "TO"]) expect(isValidUf(uf)).toBe(true);
    for (const uf of ["sp", "XX", "S", "SPP", ""]) expect(isValidUf(uf)).toBe(false);
  });
  test("IBGE municipality code is 7 digits", () => {
    expect(isValidIbgeCode("3550308")).toBe(true);
    expect(isValidIbgeCode("355030")).toBe(false);
    expect(isValidIbgeCode("35503081")).toBe(false);
    expect(isValidIbgeCode("355030a")).toBe(false);
  });
});

describe("normalizePhoneE164 (FR-047)", () => {
  test('stores "(11) 99999-0000" as +5511999990000', () => {
    expect(normalizePhoneE164("(11) 99999-0000")).toBe("+5511999990000");
  });
  test("accepts national, country-code, and plus forms", () => {
    expect(normalizePhoneE164("11999990000")).toBe("+5511999990000");
    expect(normalizePhoneE164("5511999990000")).toBe("+5511999990000");
    expect(normalizePhoneE164("+55 11 99999-0000")).toBe("+5511999990000");
    expect(normalizePhoneE164("(11) 3333-4444")).toBe("+551133334444");
    expect(normalizePhoneE164("+1 415 555 2671")).toBe("+14155552671");
  });
  test("returns null for impossible numbers", () => {
    for (const bad of ["", "abc", "123", "+0123456789", "99999", "+5511"]) expect(normalizePhoneE164(bad)).toBeNull();
  });
  test("digitsOnly strips everything else", () => {
    expect(digitsOnly("(11) 9-9999.0000")).toBe("11999990000");
  });
});
