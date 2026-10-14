// covers FR-108, ADR-017 #4 (network errors after the request left, refused requests)
import { describe, expect, test } from "bun:test";
import { classifyOutboundSend, classifyUpstreamFailure } from "./retry-schedule";

describe("network errors and local refusals", () => {
  test("a network error after the request may have left is ambiguous for a send", () => {
    expect(classifyOutboundSend({ kind: "network_error" })).toEqual({ failure: "ambiguous", errorCode: "ambiguous" });
  });

  test("a network error is transient for an idempotent call", () => {
    expect(classifyUpstreamFailure({ kind: "network_error" })).toEqual({
      failure: "transient",
      errorCode: "network_error",
    });
  });

  test("a request refused locally (SSRF guard) is permanent with its own code", () => {
    expect(classifyOutboundSend({ kind: "refused", code: "host_not_allowed" })).toEqual({
      failure: "permanent",
      errorCode: "host_not_allowed",
    });
    expect(classifyUpstreamFailure({ kind: "refused", code: "host_not_allowed" })).toEqual({
      failure: "permanent",
      errorCode: "host_not_allowed",
    });
  });
});
