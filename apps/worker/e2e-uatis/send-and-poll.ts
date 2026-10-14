// Manual suite against a local backend-uatis (10.testing.md "backend-uatis (obk_test_)").
// Gate: UATIS_E2E=1. Not part of `bun test`.
//
//   UATIS_E2E=1 UATIS_E2E_BASE_URL=http://localhost:3001 UATIS_E2E_API_KEY=obk_test_… \
//   UATIS_E2E_PHONE_NUMBER_ID=<line> UATIS_E2E_TO=+55… MT_ALLOW_PRIVATE_HOSTS=1 \
//   bun apps/worker/e2e-uatis/send-and-poll.ts
//
// Steps: testConnection, listApprovedTemplates, sendText (201 pending, or a 422
// outside_service_window that the worker would store), then the poll read from
// five minutes ago in both directions. It prints ids and states, never the key.

import { classifyOutboundSend, GatewayError } from "@mt/core";
import { createSafeFetch, UatisGateway } from "@mt/http";

if (process.env.UATIS_E2E !== "1") {
  console.log("UATIS_E2E is not 1: skipped.");
  process.exit(0);
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return v;
}

if (need("UATIS_E2E_API_KEY").startsWith("obk_live_")) {
  console.error("refusing an obk_live_ key: use an obk_test_ key (10.testing.md)");
  process.exit(2);
}

const gateway = new UatisGateway({
  baseUrl: need("UATIS_E2E_BASE_URL"),
  apiKey: need("UATIS_E2E_API_KEY"),
  fetch: createSafeFetch({ allowPrivateHosts: process.env.MT_ALLOW_PRIVATE_HOSTS === "1" }),
});
const fromAddress = need("UATIS_E2E_PHONE_NUMBER_ID");
const to = need("UATIS_E2E_TO");
const since = new Date(Date.now() - 5 * 60_000);
let failures = 0;

function step(name: string, ok: boolean, detail: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail);
}

step("testConnection", (await gateway.testConnection()).ok, "");

try {
  const templates = await gateway.listApprovedTemplates();
  step(
    "listApprovedTemplates",
    true,
    templates.map((t) => `${t.name}/${t.language}`),
  );
} catch (e) {
  step("listApprovedTemplates", false, e instanceof GatewayError ? e.failure : String(e));
}

let sentId: string | null = null;
try {
  const r = await gateway.sendText({ to, fromAddress, body: `Marmitop e2e ${new Date().toISOString()}` });
  sentId = r.externalId;
  step("sendText 201", r.status === "pending" || r.status === "sent", r);
} catch (e) {
  if (e instanceof GatewayError) {
    const c = classifyOutboundSend(e.failure);
    // outside_service_window is a correct, permanent answer when the number has not written in 24 h.
    step("sendText refused as expected?", c.errorCode === "outside_service_window", {
      call: e.failure,
      class: c.failure,
      code: c.errorCode,
    });
  } else step("sendText", false, String(e));
}

const out = await gateway.listMessages({ direction: "out", from: since, limit: 100 });
step("poll out finds the send", sentId === null || out.items.some((m) => m.externalId === sentId), {
  items: out.items.length,
});
const inbound = await gateway.listMessages({ direction: "in", from: since, limit: 100 });
step(
  "poll in maps every item",
  inbound.items.every((m) => m.direction === "in" && m.body.length > 0),
  {
    items: inbound.items.length,
  },
);

process.exit(failures === 0 ? 0 : 1);
