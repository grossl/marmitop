// Manual suite against a local web-nf in homologação (10.testing.md "web-nf (homologação)").
// Gate: NF_E2E=1. Not part of `bun test`.
//
//   NF_E2E=1 NF_E2E_BASE_URL=http://localhost:<generation-api port> NF_E2E_API_KEY=nfk_test_… \
//   MT_ALLOW_PRIVATE_HOSTS=1 bun apps/worker/e2e-nf/issue-nfce.ts
//
// Exit code 0 means every step passed. A development certificate usually ends in `rejected`;
// the suite then checks the error mapping instead of authorization (10.testing.md).

import { createSafeFetch, WebNfGateway } from "@mt/http";

import { runNfScenario } from "./scenario";

if (process.env.NF_E2E !== "1") {
  console.log("NF_E2E is not 1: skipped.");
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

const apiKey = need("NF_E2E_API_KEY");
if (!apiKey.startsWith("nfk_test_")) {
  console.error("refusing a key without the nfk_test_ prefix (10.testing.md)");
  process.exit(2);
}

const gateway = new WebNfGateway({
  baseUrl: need("NF_E2E_BASE_URL"),
  apiKey,
  fetch: createSafeFetch({ allowPrivateHosts: process.env.MT_ALLOW_PRIVATE_HOSTS === "1" }),
});

const steps = await runNfScenario(gateway, {
  timeoutMs: Number(process.env.NF_E2E_TIMEOUT_MS ?? 120_000),
  pollEveryMs: 3000,
  onCancel: () => Bun.sleep(5000),
});
for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"} ${s.name}`, s.detail);
process.exit(steps.every((s) => s.ok) ? 0 : 1);
