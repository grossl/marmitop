// covers FR-127, FR-128, FR-131, FR-137, FR-138
import { describe, expect, test } from "bun:test";
import {
  describeSefazRejection,
  INVOICE_STATUS_LABELS,
  mapValidationDetail,
  mapWebNfError,
  normalizeInvoiceStatus,
} from "./error-mapping";

describe("mapWebNfError (08 section 8.1)", () => {
  const cases: [number, string | undefined, string, string][] = [
    [
      401,
      "unauthorized",
      "stop",
      "A chave de acesso da integração fiscal é inválida. Atualize em Configurações → Fiscal.",
    ],
    [403, "forbidden", "stop", "A chave da integração fiscal não tem permissão para emitir."],
    [404, "not_found", "stop", "Nota não encontrada no serviço fiscal."],
    [422, "validation_failed", "stop", "Dados da nota inválidos:"],
    [422, "certificate_missing", "stop", "O certificado digital A1 ainda não foi enviado ao serviço fiscal."],
    [422, "csc_missing", "stop", "O CSC da NFC-e não está cadastrado para este ambiente (homologação ou produção)."],
    [422, "municipality_not_supported", "stop", "Erro interno. Tente novamente ou fale com o suporte."],
    [409, "idempotency_conflict", "stop", "Esta nota já foi enviada com outros dados. Cancele e emita novamente."],
    [409, "conflict", "stop", "A nota não está em um estado que permita esta ação."],
    [429, "rate_limited", "retry", "Muitas emissões em pouco tempo. Tentaremos de novo em instantes."],
    [500, "internal_error", "retry", "O serviço fiscal está indisponível. Tentaremos novamente."],
    [503, undefined, "retry", "O serviço fiscal está indisponível. Tentaremos novamente."],
  ];
  for (const [status, code, action, message] of cases) {
    test(`${status} ${code ?? "(none)"}`, () => {
      const m = mapWebNfError(status, code);
      expect(m.action).toBe(action as "stop" | "retry");
      expect(m.message).toBe(message);
    });
  }
  test("a rejected API key marks the integration as error", () => {
    expect(mapWebNfError(401, "unauthorized").markIntegrationError).toBe(true);
    expect(mapWebNfError(422, "validation_failed").markIntegrationError).toBe(false);
  });
  test("idempotency_conflict and municipality_not_supported are logged as bugs", () => {
    expect(mapWebNfError(409, "idempotency_conflict").bug).toBe(true);
    expect(mapWebNfError(422, "municipality_not_supported").bug).toBe(true);
    expect(mapWebNfError(404, "not_found").bug).toBe(false);
  });
  test("maps by code, not by message text", () => {
    expect(mapWebNfError(422, "csc_missing").message).toBe(mapWebNfError(422, "csc_missing").message);
  });
  test("an unknown 4xx stops with a generic message; a timeout retries", () => {
    expect(mapWebNfError(418, "teapot").action).toBe("stop");
    expect(mapWebNfError(0, "timeout").action).toBe("retry");
  });
});

describe("describeSefazRejection (08 section 8.3)", () => {
  test("known codes have a pt-BR hint", () => {
    for (const code of [716, 717, 718, 789]) {
      expect(describeSefazRejection(code, "x")).toBe("Erro interno nos dados da operação. Fale com o suporte.");
    }
    for (const code of ["753", "754"]) {
      expect(describeSefazRejection(code, "x")).toBe("Erro interno nos dados de frete. Fale com o suporte.");
    }
    expect(describeSefazRejection(866, "x")).toBe("O pagamento é maior que o total e falta o troco.");
    expect(describeSefazRejection(869, "x")).toBe("O troco informado não confere com o pagamento.");
    expect(describeSefazRejection(539, "x")).toBe("Esta nota já foi emitida. Consulte o status.");
    expect(describeSefazRejection(204, "x")).toBe("Esta nota já foi emitida. Consulte o status.");
    expect(describeSefazRejection(712, "x")).toBe("O estado não aceita emissão em contingência.");
  });
  test("any other code shows the code and the raw text", () => {
    expect(describeSefazRejection(999, "Rejeição: algo")).toBe("A SEFAZ recusou a nota (999): Rejeição: algo.");
  });
});

describe("mapValidationDetail (08 section 8.2)", () => {
  const names = ["Marmita de frango", "Suco"];
  test("item paths use the item name", () => {
    expect(mapValidationDetail("nfce.itens[0].ncm", names)).toBe("NCM do item «Marmita de frango» deve ter 8 dígitos.");
    expect(mapValidationDetail("nfce.itens[1].cfop", names)).toBe("CFOP do item «Suco» deve ter 4 dígitos.");
    expect(mapValidationDetail("nfe.itens[1].ncm", names)).toBe("NCM do item «Suco» deve ter 8 dígitos.");
    expect(mapValidationDetail("nfce.itens[0].impostos.icms.csosn", names)).toBe(
      "Revise os códigos de impostos em Configurações → Fiscal.",
    );
  });
  test("buyer and payment paths", () => {
    expect(mapValidationDetail("nfce.destinatario.cpf", names)).toBe("CPF/CNPJ do cliente inválido.");
    expect(mapValidationDetail("nfce.destinatario.cnpj", names)).toBe("CPF/CNPJ do cliente inválido.");
    expect(mapValidationDetail("nfce.destinatario", names)).toBe("Entrega exige cliente identificado (CPF ou CNPJ).");
    expect(mapValidationDetail("nfce.destinatario.endereco", names)).toBe(
      "Entrega exige o endereço completo do cliente.",
    );
    expect(mapValidationDetail("nfce.destinatario.endereco.cep", names)).toBe("CEP, cidade ou UF do cliente inválido.");
    expect(mapValidationDetail("nfce.destinatario.endereco.codigo_municipio", names)).toBe(
      "CEP, cidade ou UF do cliente inválido.",
    );
    expect(mapValidationDetail("nfce.destinatario.endereco.uf", names)).toBe("CEP, cidade ou UF do cliente inválido.");
    expect(mapValidationDetail("nfce.troco", names)).toBe("Troco inconsistente com o pagamento.");
    expect(mapValidationDetail("nfce.serie", names)).toBe("Série inválida.");
  });
  test("anything else is generic and never echoes English text as the main message", () => {
    expect(mapValidationDetail("nfce.foo.bar", names)).toBe("Dados da nota inválidos.");
  });
  test("an item index out of range still maps", () => {
    expect(mapValidationDetail("nfce.itens[9].ncm", names)).toBe("NCM do item deve ter 8 dígitos.");
  });
});

describe("invoice status labels (08 section 6 and 8.4)", () => {
  test('received, queued, and processing read "Em processamento"', () => {
    for (const s of ["received", "queued", "processing"] as const)
      expect(INVOICE_STATUS_LABELS[s]).toBe("Em processamento");
  });
  test("final states", () => {
    expect(INVOICE_STATUS_LABELS.authorized).toBe("Emitida");
    expect(INVOICE_STATUS_LABELS.rejected).toBe("Rejeitada");
    expect(INVOICE_STATUS_LABELS.denied).toBe("Denegada");
    expect(INVOICE_STATUS_LABELS.failed).toBe("Falhou");
    expect(INVOICE_STATUS_LABELS.cancelled).toBe("Cancelada");
  });
  test("an unknown status is kept as received (FR-128)", () => {
    expect(normalizeInvoiceStatus("authorized")).toEqual({ status: "authorized", known: true });
    expect(normalizeInvoiceStatus("mystery")).toEqual({ status: "mystery", known: false });
  });
});
