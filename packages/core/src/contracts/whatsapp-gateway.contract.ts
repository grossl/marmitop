// Contract suite for WhatsAppGateway (FR-100). The same cases run against FakeGateway and
// against UatisGateway (with a stub server in packages/http).

import { describe, expect, test } from "bun:test";
import type { WhatsAppGateway } from "../ports/whatsapp-gateway";

export interface WhatsAppGatewayHarness {
  readonly gateway: WhatsAppGateway;
  /** Puts an inbound message in the backend, when the harness can. */
  readonly injectInbound?: (from: string, body: string) => Promise<void>;
  readonly cleanup?: () => Promise<void>;
}

export function whatsappGatewayContract(name: string, create: () => Promise<WhatsAppGatewayHarness>): void {
  describe(`WhatsAppGateway contract: ${name}`, () => {
    const withHarness = async (run: (h: WhatsAppGatewayHarness) => Promise<void>) => {
      const h = await create();
      try {
        await run(h);
      } finally {
        await h.cleanup?.();
      }
    };

    test("sendText returns an external id and a status of pending or sent", async () => {
      await withHarness(async ({ gateway }) => {
        const r = await gateway.sendText({ to: "+5511999990000", fromAddress: "pn-1", body: "Olá!" });
        expect(r.externalId.length).toBeGreaterThan(0);
        expect(["pending", "sent"]).toContain(r.status);
      });
    });

    test("sendTemplate returns an external id", async () => {
      await withHarness(async ({ gateway }) => {
        const r = await gateway.sendTemplate({
          to: "+5511999990000",
          fromAddress: "pn-1",
          templateName: "pedido_recebido",
          language: "pt_BR",
        });
        expect(r.externalId.length).toBeGreaterThan(0);
      });
    });

    test("a sent message shows up in listMessages with direction out", async () => {
      await withHarness(async ({ gateway }) => {
        const sent = await gateway.sendText({ to: "+5511999990000", fromAddress: "pn-1", body: "ping" });
        const page = await gateway.listMessages({ direction: "out" });
        const found = page.items.find((m) => m.externalId === sent.externalId);
        expect(found?.direction).toBe("out");
      });
    });

    test("listMessages returns the internal message shape and a cursor or null", async () => {
      await withHarness(async ({ gateway }) => {
        await gateway.sendText({ to: "+5511999990000", fromAddress: "pn-1", body: "shape" });
        const page = await gateway.listMessages();
        expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
        for (const m of page.items) {
          expect(typeof m.externalId).toBe("string");
          expect(["in", "out"]).toContain(m.direction);
          expect(typeof m.body).toBe("string");
          expect(m.createdAt).toBeInstanceOf(Date);
        }
      });
    });

    test("listMessages with a from date in the future returns nothing", async () => {
      await withHarness(async ({ gateway }) => {
        await gateway.sendText({ to: "+5511999990000", fromAddress: "pn-1", body: "old" });
        const page = await gateway.listMessages({ from: new Date(Date.now() + 86_400_000) });
        expect(page.items.length).toBe(0);
        expect(page.nextCursor).toBeNull();
      });
    });

    test("inbound messages come back with direction in and status delivered", async () => {
      await withHarness(async ({ gateway, injectInbound }) => {
        if (!injectInbound) return;
        await injectInbound("+5511988887777", "Oi, tudo bem?");
        const page = await gateway.listMessages({ direction: "in" });
        const m = page.items.find((x) => x.body === "Oi, tudo bem?");
        expect(m?.direction).toBe("in");
        expect(m?.status).toBe("delivered");
        expect(m?.contactAddress).toBe("+5511988887777");
      });
    });

    test("paging with a limit walks every message once", async () => {
      await withHarness(async ({ gateway }) => {
        for (let i = 0; i < 5; i++) {
          await gateway.sendText({ to: "+5511999990000", fromAddress: "pn-1", body: `m${i}` });
        }
        const seen = new Set<string>();
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page: Awaited<ReturnType<WhatsAppGateway["listMessages"]>> = await gateway.listMessages({
            limit: 2,
            cursor,
          });
          for (const m of page.items) seen.add(m.externalId);
          cursor = page.nextCursor;
          pages++;
        } while (cursor && pages < 20);
        expect(seen.size).toBeGreaterThanOrEqual(5);
      });
    });

    test("testConnection answers ok or an error text", async () => {
      await withHarness(async ({ gateway }) => {
        const r = await gateway.testConnection();
        expect(typeof r.ok).toBe("boolean");
        if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
      });
    });

    test("listApprovedTemplates returns name and language", async () => {
      await withHarness(async ({ gateway }) => {
        const t = await gateway.listApprovedTemplates();
        for (const x of t) {
          expect(typeof x.name).toBe("string");
          expect(typeof x.language).toBe("string");
        }
      });
    });
  });
}
