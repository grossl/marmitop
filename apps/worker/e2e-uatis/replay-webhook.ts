// Replays one signed backend-uatis event into apps/api, to check signature handling
// while backend-uatis does not deliver webhooks (ADR-002). Gate: UATIS_E2E=1.
//
//   UATIS_E2E=1 MT_API_URL=http://localhost:3101 UATIS_E2E_RESTAURANT_ID=<uuid> \
//   UATIS_E2E_WEBHOOK_SECRET=<the secret saved in Settings> UATIS_E2E_TO=+55… \
//   bun apps/worker/e2e-uatis/replay-webhook.ts
//
// Expect 200 twice (the replay is idempotent), then 401 with a wrong secret.

import { signWebhook } from "@mt/core";

if (process.env.UATIS_E2E !== "1") {
  console.log("UATIS_E2E is not 1: skipped.");
  process.exit(0);
}
const api = process.env.MT_API_URL ?? "http://localhost:3101";
const restaurantId = process.env.UATIS_E2E_RESTAURANT_ID ?? "";
const secret = process.env.UATIS_E2E_WEBHOOK_SECRET ?? "";
const from = process.env.UATIS_E2E_TO ?? "+5511999990000";

const body = JSON.stringify({
  id: crypto.randomUUID(),
  type: "message.created",
  created_at: new Date().toISOString(),
  organization_id: "e2e",
  data: {
    message: {
      id: crypto.randomUUID(),
      conversation_id: crypto.randomUUID(),
      direction: "in",
      content: { version: "1", type: "text", kind: "text", text: "Oi (replay e2e)" },
      status: { state: "received", errors: [] },
      contact_address: from,
      created_at: new Date().toISOString(),
    },
  },
});

async function post(withSecret: string) {
  const t = Math.floor(Date.now() / 1000);
  const res = await fetch(`${api}/v1/webhooks/uatis/${restaurantId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Uatis-Signature": signWebhook(withSecret, t, body) },
    body,
  });
  return res.status;
}

const results = [await post(secret), await post(secret), await post(`${secret}-wrong`)];
console.log("statuses", results, "expected [200, 200, 401]");
process.exit(results.join() === "200,200,401" ? 0 : 1);
