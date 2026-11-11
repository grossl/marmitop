// covers NFR-061
import { describe, expect, test } from "bun:test";
import * as pkg from "./index";

describe("@mt/core public surface", () => {
  test("exports the domain functions and fakes the other packages rely on", () => {
    for (const name of [
      "AppError",
      "computeOrderTotal",
      "canTransition",
      "applyTransition",
      "isOpenAt",
      "nextOpening",
      "decideInboundAutoMessage",
      "decideOrderReceived",
      "decideServiceWindow",
      "buildReport",
      "signWebhook",
      "verifySignature",
      "verifyUatisSignature",
      "verifyNfSignature",
      "buildOutboundWebhookHeaders",
      "buildInvoiceRequest",
      "precheckInvoice",
      "centsToReais",
      "parseUatisWebhookEvent",
      "generateApiKey",
      "checkOutboundUrl",
      "EnvelopeSecretBox",
      "FakeGateway",
      "FakeInvoiceGateway",
      "FixedClock",
      "NullBillingProvider",
      "decideAfterFailure",
    ]) {
      expect((pkg as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  test("core imports nothing internal and no adapter or I/O module", async () => {
    const { Glob } = await import("bun");
    const glob = new Glob("**/*.ts");
    // import.meta.dir, not URL.pathname: the pathname keeps a space as %20.
    const root = `${import.meta.dir}/`;
    const forbidden =
      /from ['"](@mt\/|node:(fs|net|http|https|child_process|dns|dgram|tls|worker_threads)|postgres|hono|next)/;
    for await (const file of glob.scan({ cwd: root })) {
      if (file.endsWith(".test.ts") || file.startsWith("contracts/")) continue;
      const text = await Bun.file(`${root}${file}`).text();
      expect(forbidden.test(text), file).toBe(false);
    }
  });
});
