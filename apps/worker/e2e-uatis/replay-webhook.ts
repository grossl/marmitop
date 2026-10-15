// Replays one signed backend-uatis push into apps/api, in the exact format the backend-uatis
// worker sends (its apps/worker/src/body.ts and deliver.ts, commit c887ef0; ADR-021, ADR-023).
// No tunnel is needed: this posts to the local api directly. Gate: UATIS_E2E=1.
//
//   UATIS_E2E=1 MT_API_URL=http://localhost:3101 UATIS_E2E_RESTAURANT_ID=<uuid> \
//   UATIS_E2E_WEBHOOK_SECRET=<the stored uatis_webhook_secret> \
//   [UATIS_E2E_ORGANIZATION_ID=<integrations_whatsapp.uatis_organization_id, when set>] \
//   [UATIS_E2E_FROM=5511999990000] bun apps/worker/e2e-uatis/replay-webhook.ts
//
// Expect 200, then 200 for the same delivery re-signed (deduplicated by event id), then 401 with
// a wrong secret. With UATIS_E2E_ORGANIZATION_ID set, also 401 for another organization.

import { signWebhook } from "@mt/core";

if (process.env.UATIS_E2E !== "1") {
  console.log("UATIS_E2E is not 1: skipped.");
  process.exit(0);
}
const api = process.env.MT_API_URL ?? "http://localhost:3101";
const restaurantId = process.env.UATIS_E2E_RESTAURANT_ID ?? "";
const secret = process.env.UATIS_E2E_WEBHOOK_SECRET ?? "";
const organizationId = process.env.UATIS_E2E_ORGANIZATION_ID ?? "";
// backend-uatis stores the contact address as digits, without "+".
const from = (process.env.UATIS_E2E_FROM ?? "5511999990000").replace(/^\+/, "");
const text = process.env.UATIS_E2E_TEXT ?? `Oi (replay e2e ${new Date().toISOString()})`;

function envelope(org: string): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    id: crypto.randomUUID(),
    type: "message.created",
    created_at: now,
    organization_id: org,
    data: {
      message: {
        id: crypto.randomUUID(),
        conversation_id: crypto.randomUUID(),
        direction: "in",
        content: { version: "1", type: "text", kind: "text", text },
        status: { state: "received", errors: [] },
        contact_address: from,
        created_at: now,
      },
    },
  });
}

async function post(body: string, withSecret: string): Promise<number> {
  const t = Math.floor(Date.now() / 1000);
  const parsed = JSON.parse(body) as { id: string; type: string };
  const res = await fetch(`${api}/v1/webhooks/uatis/${restaurantId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Uatis-Signature": signWebhook(withSecret, t, body),
      "X-Uatis-Event": parsed.type,
      "X-Uatis-Delivery": parsed.id,
      "User-Agent": "uatis-worker/1.0",
    },
    body,
  });
  return res.status;
}

const org = organizationId || crypto.randomUUID();
const body = envelope(org);
const results = [await post(body, secret), await post(body, secret), await post(body, `${secret}-wrong`)];
const expected = [200, 200, 401];
if (organizationId) {
  results.push(await post(envelope(crypto.randomUUID()), secret));
  expected.push(401);
}
console.log("statuses", results, "expected", expected, "message text", JSON.stringify(text));
process.exit(results.join() === expected.join() ? 0 : 1);
