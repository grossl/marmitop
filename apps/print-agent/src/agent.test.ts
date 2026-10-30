// covers FR-254, NFR-064
import { describe, expect, test } from "bun:test";

import { runOnce } from "./agent";
import { loadConfig } from "./config";
import { HttpPrintJobApi } from "./http-api";
import type { ClaimedJob, Logger, PrintJobApi, TicketPrinter, WireTicket } from "./ports";

const KEY = "mtk_test_CasaDev0000000000000000000000001";

const ticket: WireTicket = {
  restaurant_name: "Marmita da Casa",
  timezone: "America/Sao_Paulo",
  customer_name: "Ana Souza",
  customer_phone: "5511999990000",
  order: {
    code: "ORD-012",
    fulfillment: "pickup",
    source: "whatsapp",
    created_at: "2026-10-30T16:48:00.000Z",
    notes: null,
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    cidade: null,
    uf: null,
    cep: null,
    payment_method: "pix",
    change_for_cents: null,
    subtotal_cents: 3780,
    delivery_fee_cents: 0,
    total_cents: 3780,
    items: [{ name: "Frango Grelhado", size_name: "M", unit_price_cents: 1890, qty: 2, notes: null }],
  },
};

class FakeApi implements PrintJobApi {
  reports: { id: string; printed: boolean; error?: string }[] = [];
  constructor(
    private jobs: ClaimedJob[],
    private readonly fail = false,
  ) {}
  async claim(): Promise<ClaimedJob[]> {
    if (this.fail) throw new Error("POST /v1/print-jobs/claim answered 503");
    const out = this.jobs;
    this.jobs = [];
    return out;
  }
  async report(id: string, result: { printed: true } | { printed: false; error: string }): Promise<void> {
    this.reports.push({ id, ...result });
  }
}

class FakePrinter implements TicketPrinter {
  printed: Uint8Array[] = [];
  constructor(private readonly error: string | null = null) {}
  async print(bytes: Uint8Array): Promise<void> {
    if (this.error) throw new Error(this.error);
    this.printed.push(bytes);
  }
}

function memoryLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (m: string, f?: Record<string, unknown>) => lines.push(JSON.stringify({ m, ...f }));
  return { lines, info: push, warn: push, error: push };
}

const job = (id: string): ClaimedJob => ({ id, attempts: 1, ticket });

describe("runOnce", () => {
  test("a printed job reports printed: true", async () => {
    const api = new FakeApi([job("j1"), job("j2")]);
    const printer = new FakePrinter();
    const log = memoryLog();
    expect(await runOnce({ api, printer, log, columns: 48 })).toBe(2);
    expect(printer.printed).toHaveLength(2);
    expect(new TextDecoder("latin1").decode(printer.printed[0])).toContain("ORD-012");
    expect(api.reports).toEqual([
      { id: "j1", printed: true },
      { id: "j2", printed: true },
    ]);
  });

  test("a printer error reports printed: false with the error", async () => {
    const api = new FakeApi([job("j1")]);
    await runOnce({ api, printer: new FakePrinter("lp exited 1: no paper"), log: memoryLog(), columns: 48 });
    expect(api.reports).toEqual([{ id: "j1", printed: false, error: "lp exited 1: no paper" }]);
  });

  test("an API error on claim prints nothing", async () => {
    const printer = new FakePrinter();
    expect(await runOnce({ api: new FakeApi([job("j1")], true), printer, log: memoryLog(), columns: 48 })).toBe(0);
    expect(printer.printed).toHaveLength(0);
  });

  test("logs carry the job id and order code, never the customer or the ticket text", async () => {
    const log = memoryLog();
    await runOnce({ api: new FakeApi([job("j1")]), printer: new FakePrinter(), log, columns: 48 });
    const all = log.lines.join("\n");
    expect(all).toContain("j1");
    expect(all).toContain("ORD-012");
    expect(all).not.toContain("Ana Souza");
    expect(all).not.toContain("Frango");
  });
});

describe("HttpPrintJobApi", () => {
  test("sends the key as a bearer token and keeps it out of errors", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("Authorization") });
      return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
    }) as unknown as typeof fetch;
    const api = new HttpPrintJobApi("http://localhost:3101/", KEY, fetchFn);
    const err = (await api.claim(5).catch((e) => e)) as Error;
    expect(seen).toEqual([{ url: "http://localhost:3101/v1/print-jobs/claim", auth: `Bearer ${KEY}` }]);
    expect(err.message).toBe("POST /v1/print-jobs/claim answered 401 unauthorized");
    expect(err.message).not.toContain(KEY);
  });
});

describe("loadConfig", () => {
  test("needs the URL, the key, and the printer; defaults poll and columns", () => {
    expect(() => loadConfig({})).toThrow("Missing MT_API_URL, MT_API_KEY, MT_PRINTER");
    expect(() => loadConfig({ MT_API_URL: "x", MT_API_KEY: "secret", MT_PRINTER: "p" })).toThrow(
      "not a Marmitop API key",
    );
    expect(loadConfig({ MT_API_URL: "http://a", MT_API_KEY: KEY, MT_PRINTER: "Elgin_i8" })).toMatchObject({
      pollMs: 3000,
      columns: 48,
      printer: "Elgin_i8",
    });
  });
});
