// covers FR-125 (the worker validates the frozen payload again), ADR-016
import { describe, expect, test } from "bun:test";

import { checkFrozenPayload } from "./invoice-store";

const id = "0d9e2b34-5c11-4e7a-8d2f-6a5b9c0e1f22";
const ok = { kind: "nfce", reference: id, nfce: { itens: [{}], pagamentos: [{}] } };

describe("checkFrozenPayload", () => {
  test("a body built by issueInvoice passes", () => {
    expect(checkFrozenPayload(ok, { id, kind: "nfce" })).toBeNull();
  });
  test("each gap names its field", () => {
    expect(checkFrozenPayload(null, { id, kind: "nfce" })).toBe("request_payload");
    expect(checkFrozenPayload(ok, { id, kind: "nfe" })).toBe("request_payload.kind");
    expect(checkFrozenPayload({ ...ok, reference: "other" }, { id, kind: "nfce" })).toBe("request_payload.reference");
    expect(checkFrozenPayload({ kind: "nfce", reference: id }, { id, kind: "nfce" })).toBe("request_payload.nfce");
    expect(checkFrozenPayload({ ...ok, nfce: { itens: [], pagamentos: [{}] } }, { id, kind: "nfce" })).toBe(
      "request_payload.nfce.itens",
    );
    expect(checkFrozenPayload({ ...ok, nfce: { itens: [{}], pagamentos: [] } }, { id, kind: "nfce" })).toBe(
      "request_payload.nfce.pagamentos",
    );
  });
});
