// covers FR-034, FR-045, FR-046, FR-047, FR-143
import { describe, expect, test } from "bun:test";
import {
  createCustomerActionSchema,
  createCustomerBodySchema,
  listCustomersQuerySchema,
  updateCustomerActionSchema,
  updateCustomerBodySchema,
} from "./customers";

const U1 = "3f6c1a0e-7a3b-4b1e-9c53-1f3f6d0f6a11";

describe("createCustomerBodySchema", () => {
  test("name and phone are required; the phone is stored as E.164", () => {
    const c = createCustomerBodySchema.parse({ name: " Ana Souza ", phone: "(11) 99999-0000" });
    expect(c).toMatchObject({ name: "Ana Souza", phone: "+5511999990000" });
    expect(createCustomerBodySchema.safeParse({ phone: "(11) 99999-0000" }).success).toBe(false);
    expect(createCustomerBodySchema.safeParse({ name: "Ana" }).success).toBe(false);
    expect(createCustomerBodySchema.safeParse({ name: "", phone: "(11) 99999-0000" }).success).toBe(false);
    expect(createCustomerBodySchema.safeParse({ name: "x".repeat(121), phone: "(11) 99999-0000" }).success).toBe(false);
  });
  test("optional email, CPF/CNPJ, structured address, notes", () => {
    const c = createCustomerBodySchema.parse({
      name: "Ana",
      phone: "11999990000",
      email: "ana@example.com",
      cpf_cnpj: "111.444.777-35",
      cep: "01310-100",
      logradouro: "Rua A",
      numero: "S/N",
      bairro: "Centro",
      cidade: "São Paulo",
      uf: "sp",
      codigo_municipio: "3550308",
      notes: "alergia a amendoim",
    });
    expect(c).toMatchObject({ cpf_cnpj: "11144477735", cep: "01310100", uf: "SP", email: "ana@example.com" });
  });
  test("cep with other than 8 digits is a field error (FR-045)", () => {
    const r = createCustomerBodySchema.safeParse({ name: "Ana", phone: "11999990000", cep: "123" });
    if (r.success) throw new Error("should fail");
    expect(r.error.issues[0]?.path).toEqual(["cep"]);
  });
  test("rejects a bad email, bad CPF, notes over 1000 characters", () => {
    const base = { name: "Ana", phone: "11999990000" };
    expect(createCustomerBodySchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(createCustomerBodySchema.safeParse({ ...base, cpf_cnpj: "111.444.777-36" }).success).toBe(false);
    expect(createCustomerBodySchema.safeParse({ ...base, notes: "x".repeat(1001) }).success).toBe(false);
  });
  test("blank optional strings become null", () => {
    const c = createCustomerBodySchema.parse({
      name: "Ana",
      phone: "11999990000",
      email: "",
      cpf_cnpj: "",
      cep: "",
      complemento: "  ",
    });
    expect(c.email).toBeNull();
    expect(c.cpf_cnpj).toBeNull();
    expect(c.cep).toBeNull();
    expect(c.complemento).toBeNull();
  });
});

describe("updateCustomerBodySchema (PATCH: phone cannot change)", () => {
  test("partial updates", () => {
    expect(updateCustomerBodySchema.parse({ bairro: "Mooca" })).toEqual({ bairro: "Mooca" });
    expect(updateCustomerBodySchema.safeParse({}).success).toBe(true);
  });
  test("phone is rejected", () => {
    expect(updateCustomerBodySchema.safeParse({ phone: "11999990000" }).success).toBe(false);
  });
});

describe("Server Action variants (camelCase)", () => {
  test("create", () => {
    const c = createCustomerActionSchema.parse({
      name: "Ana",
      phone: "11999990000",
      cpfCnpj: "11.222.333/0001-81",
      codigoMunicipio: "3550308",
    });
    expect(c).toMatchObject({ cpfCnpj: "11222333000181", codigoMunicipio: "3550308", phone: "+5511999990000" });
  });
  test("update may change every field, including the phone (FR-046)", () => {
    const u = updateCustomerActionSchema.parse({ customerId: U1, phone: "11988887777", name: "Ana B" });
    expect(u).toMatchObject({ customerId: U1, phone: "+5511988887777" });
    expect(updateCustomerActionSchema.safeParse({ name: "x" }).success).toBe(false);
  });
});

describe("listCustomersQuerySchema", () => {
  test("q and pagination", () => {
    expect(listCustomersQuerySchema.parse({ q: "ana" })).toEqual({ q: "ana", limit: 50 });
  });
});
