// covers FR-124, FR-127, FR-129, FR-130, ADR-003: the NF_E2E scenario's dry run against
// FakeWebNfServer, which returns the shapes web-nf really returns (10.testing.md).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createSafeFetch, WebNfGateway } from "@mt/http";
import { FakeWebNfServer } from "@mt/http/testing";

import { runNfScenario } from "../e2e-nf/scenario";

let server: FakeWebNfServer;
beforeEach(() => {
  server = new FakeWebNfServer().start();
});
afterEach(async () => {
  await server.stop();
});

const gateway = () =>
  new WebNfGateway({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: createSafeFetch({ allowPrivateHosts: true, timeoutMs: 2000 }),
  });

test("issue, replay, poll to authorized, files, cancel", async () => {
  const steps = await runNfScenario(gateway(), {
    timeoutMs: 2000,
    pollEveryMs: 5,
    onPoll: (id, round) => {
      if (round === 1) server.authorize(id);
    },
    onCancel: (id) => {
      server.settleCancel(id, "authorized");
    },
  });
  expect(steps.filter((s) => !s.ok)).toEqual([]);
  expect(steps.map((s) => s.name)).toContain("cancel event visible");
});

test("a SEFAZ rejection maps to a pt-BR hint", async () => {
  const steps = await runNfScenario(gateway(), {
    timeoutMs: 2000,
    pollEveryMs: 5,
    onPoll: (id) => {
      server.reject(id, "539", "Rejeição: Duplicidade de NF-e");
    },
  });
  expect(steps.filter((s) => !s.ok)).toEqual([]);
  expect(steps.at(-1)?.name).toBe("error maps to a pt-BR hint");
});

test("a wrong key stops at testConnection", async () => {
  const bad = new WebNfGateway({
    baseUrl: server.baseUrl,
    apiKey: "nfk_test_wrong",
    fetch: createSafeFetch({ allowPrivateHosts: true, timeoutMs: 2000 }),
  });
  const steps = await runNfScenario(bad, { timeoutMs: 100, pollEveryMs: 5 });
  expect(steps).toEqual([{ name: "testConnection", ok: false, detail: "A chave de API foi recusada pelo web-nf." }]);
});
