// covers FR-126, FR-127, FR-128, FR-130, FR-131, FR-136
import { describe, expect, test } from "bun:test";

import {
  CANCEL_WINDOW_MS,
  cancelWindowWarning,
  decideInvoiceUpdate,
  type InvoiceRowState,
  invoiceErrorText,
  isAmbiguousFailure,
  latestCancelOutcome,
  nfWebhookStatus,
  parseNfWebhookEvent,
} from "./invoice-lifecycle";

const row = (over: Partial<InvoiceRowState> = {}): InvoiceRowState => ({
  status: "queued",
  numero: null,
  serie: null,
  chaveAcesso: null,
  errorCode: null,
  errorMessage: null,
  ...over,
});

const KEY = "4".repeat(44);

describe("decideInvoiceUpdate (FR-127, FR-136)", () => {
  test("queued to processing applies", () => {
    expect(decideInvoiceUpdate(row(), { status: "processing" })).toEqual({
      apply: true,
      patch: { status: "processing" },
    });
  });

  test("received is stored as received (the UI reads it as Em processamento)", () => {
    expect(decideInvoiceUpdate(row(), { status: "received" })).toEqual({ apply: true, patch: { status: "received" } });
  });

  test("a non-final status never moves backward", () => {
    expect(decideInvoiceUpdate(row({ status: "processing" }), { status: "queued" })).toEqual({ apply: false });
  });

  test("authorized stores numero, serie, and chave and clears an old error", () => {
    const d = decideInvoiceUpdate(row({ status: "processing", errorCode: "x", errorMessage: "y" }), {
      status: "authorized",
      numero: 12,
      serie: 1,
      chaveAcesso: KEY,
    });
    expect(d).toEqual({
      apply: true,
      patch: { status: "authorized", numero: 12, serie: 1, chaveAcesso: KEY, errorCode: null, errorMessage: null },
    });
  });

  test("rejected stores the error code and message", () => {
    const d = decideInvoiceUpdate(row({ status: "processing" }), {
      status: "rejected",
      error: { code: "539", message: "Duplicidade de NF-e" },
    });
    expect(d).toEqual({
      apply: true,
      patch: { status: "rejected", errorCode: "539", errorMessage: "Duplicidade de NF-e" },
    });
  });

  test("the same final status again changes nothing (FR-136)", () => {
    const current = row({ status: "authorized", numero: 12, serie: 1, chaveAcesso: KEY });
    expect(decideInvoiceUpdate(current, { status: "authorized", numero: 12, serie: 1, chaveAcesso: KEY })).toEqual({
      apply: false,
    });
  });

  test("the same final status fills fields that were missing (a webhook carries no error)", () => {
    const current = row({ status: "rejected" });
    expect(decideInvoiceUpdate(current, { status: "rejected", error: { code: "204", message: "Dup" } })).toEqual({
      apply: true,
      patch: { errorCode: "204", errorMessage: "Dup" },
    });
  });

  test("a final status never moves back to a non-final one", () => {
    expect(decideInvoiceUpdate(row({ status: "authorized" }), { status: "processing" })).toEqual({ apply: false });
  });

  test("a final status never moves to another final one, except authorized to cancelled", () => {
    expect(decideInvoiceUpdate(row({ status: "rejected" }), { status: "authorized" })).toEqual({ apply: false });
    expect(decideInvoiceUpdate(row({ status: "authorized" }), { status: "cancelled" })).toEqual({
      apply: true,
      patch: { status: "cancelled" },
    });
  });

  test("an unknown status is ignored", () => {
    expect(decideInvoiceUpdate(row(), { status: "teleported" })).toEqual({ apply: false });
  });

  test("an error message is cut to 500 characters", () => {
    const d = decideInvoiceUpdate(row(), { status: "failed", error: { code: "x", message: "a".repeat(900) } });
    expect(d.apply && d.patch.errorMessage?.length).toBe(500);
  });
});

describe("parseNfWebhookEvent (06.api-spec.md, web-nf webhook-fanout.ts)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    id: "d-1",
    type: "invoice.authorized",
    created_at: "2026-10-13T12:00:00Z",
    data: {
      invoice: { id: "inv-1", kind: "nfce", status: "authorized", numero: 12, chave_acesso: KEY, reference: "ref-1" },
    },
    ...over,
  });

  test("reads the invoice part", () => {
    expect(parseNfWebhookEvent(body())).toEqual({
      type: "invoice.authorized",
      deliveryId: "d-1",
      invoice: { id: "inv-1", status: "authorized", numero: 12, chaveAcesso: KEY, reference: "ref-1" },
      event: null,
    });
  });

  test("reads the event part of an event.* delivery", () => {
    const e = parseNfWebhookEvent(
      body({
        type: "event.rejected",
        data: {
          invoice: { id: "inv-1", kind: "nfce", status: "authorized", numero: 12, chave_acesso: null, reference: null },
          event: { id: "ev-1", type: "cancelamento", status: "rejected" },
        },
      }),
    );
    expect(e.type).toBe("event.rejected");
    expect(e.event).toEqual({ id: "ev-1", type: "cancelamento", status: "rejected" });
    expect(e.invoice.chaveAcesso).toBeNull();
  });

  test("an unknown type is kept for the caller to ignore", () => {
    expect(parseNfWebhookEvent(body({ type: "invoice.teleported" })).type).toBe("invoice.teleported");
  });

  test("a body without data.invoice.id is a validation error", () => {
    expect(() => parseNfWebhookEvent({ type: "invoice.authorized", data: {} })).toThrow();
    expect(() => parseNfWebhookEvent("x")).toThrow();
  });

  test("nfWebhookStatus maps invoice.* and leaves event.* to a refresh", () => {
    expect(nfWebhookStatus("invoice.authorized")).toBe("authorized");
    expect(nfWebhookStatus("invoice.rejected")).toBe("rejected");
    expect(nfWebhookStatus("invoice.denied")).toBe("denied");
    expect(nfWebhookStatus("invoice.failed")).toBe("failed");
    expect(nfWebhookStatus("invoice.cancelled")).toBe("cancelled");
    expect(nfWebhookStatus("event.authorized")).toBeNull();
    expect(nfWebhookStatus("event.rejected")).toBeNull();
  });
});

describe("latestCancelOutcome", () => {
  test("null without a cancelamento event", () => {
    expect(latestCancelOutcome(undefined)).toBeNull();
    expect(latestCancelOutcome([{ type: "carta_correcao", status: "authorized", error: null }])).toBeNull();
  });
  test("the last cancelamento wins", () => {
    expect(
      latestCancelOutcome([
        { type: "cancelamento", status: "rejected", error: { code: "501", message: "Prazo" } },
        { type: "cancelamento", status: "queued", error: null },
      ]),
    ).toEqual({ status: "queued", error: null });
  });
});

describe("invoiceErrorText (08 section 8, FR-131)", () => {
  test("no code, no text", () => {
    expect(invoiceErrorText({ status: "authorized", errorCode: null, errorMessage: null })).toBeNull();
  });
  test("a SEFAZ code on a rejected invoice uses the 8.3 hint", () => {
    expect(invoiceErrorText({ status: "rejected", errorCode: "866", errorMessage: "x" })).toBe(
      "O pagamento é maior que o total e falta o troco.",
    );
    expect(invoiceErrorText({ status: "rejected", errorCode: "999", errorMessage: "Rejeição: algo" })).toBe(
      "A SEFAZ recusou a nota (999): Rejeição: algo.",
    );
  });
  test("denied asks to fix the issuer registration", () => {
    expect(invoiceErrorText({ status: "denied", errorCode: "301", errorMessage: "x" })).toBe(
      "Regularize o cadastro do emitente na SEFAZ.",
    );
  });
  test("validation_failed shows the stored pt-BR text", () => {
    expect(
      invoiceErrorText({
        status: "failed",
        errorCode: "validation_failed",
        errorMessage: "Dados da nota inválidos: X",
      }),
    ).toBe("Dados da nota inválidos: X");
  });
  test("a web-nf code maps through 8.1", () => {
    expect(invoiceErrorText({ status: "failed", errorCode: "csc_missing", errorMessage: "raw" })).toBe(
      "O CSC da NFC-e não está cadastrado para este ambiente (homologação ou produção).",
    );
  });
  test("an ambiguous failure reads as the service not answering and says a retry reuses the request", () => {
    expect(invoiceErrorText({ status: "failed", errorCode: "ambiguous", errorMessage: null })).toBe(
      "O serviço fiscal não respondeu. Emitir novamente reenvia a mesma nota, sem duplicar.",
    );
  });
  test("isAmbiguousFailure: only a failed row with the ambiguous code (FR-132, ADR-016)", () => {
    expect(isAmbiguousFailure({ status: "failed", errorCode: "ambiguous" })).toBe(true);
    expect(isAmbiguousFailure({ status: "failed", errorCode: "validation_failed" })).toBe(false);
    expect(isAmbiguousFailure({ status: "rejected", errorCode: "ambiguous" })).toBe(false);
  });
  test("a transport failure reads as the service not answering", () => {
    expect(invoiceErrorText({ status: "failed", errorCode: "timeout", errorMessage: null })).toBe(
      "O serviço fiscal não respondeu.",
    );
  });
  test("a cancel failure shows its stored text", () => {
    expect(
      invoiceErrorText({ status: "authorized", errorCode: "cancel_rejected", errorMessage: "Prazo de cancelamento" }),
    ).toBe("Prazo de cancelamento");
  });
});

describe("cancelWindowWarning (FR-130, ADR-016)", () => {
  const authorizedAt = "2026-10-13T12:00:00Z";
  test("NFC-e always warns about the short window", () => {
    const w = cancelWindowWarning("nfce", authorizedAt, new Date("2026-10-13T12:10:00Z"));
    expect(w).toContain("30 minutos");
    expect(w).not.toContain("mais de 30 minutos");
  });
  test("NFC-e past 30 minutes says the cancel may be rejected", () => {
    const at = new Date(new Date(authorizedAt).getTime() + CANCEL_WINDOW_MS + 1);
    expect(cancelWindowWarning("nfce", authorizedAt, at)).toContain("mais de 30 minutos");
  });
  test("NF-e has no NFC-e window warning", () => {
    expect(cancelWindowWarning("nfe", authorizedAt, new Date())).toBeNull();
  });
  test("unknown authorization time still warns", () => {
    expect(cancelWindowWarning("nfce", null, new Date())).toContain("30 minutos");
  });
});
