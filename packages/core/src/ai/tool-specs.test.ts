// covers FR-184, FR-195
import { describe, expect, test } from "bun:test";

import { AI_TOOL_NAMES, AI_TOOL_SPECS } from "./tool-specs";

describe("AI_TOOL_SPECS", () => {
  test("one spec per tool name, in a fixed order", () => {
    expect(AI_TOOL_SPECS.map((t) => t.name)).toEqual([...AI_TOOL_NAMES]);
  });
  test("strict-ready: every object schema lists all properties as required and forbids extras", () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === "object") {
        const props = Object.keys((s.properties as Record<string, unknown>) ?? {});
        expect(s.additionalProperties).toBe(false);
        expect([...((s.required as string[]) ?? [])].sort()).toEqual(props.sort());
        for (const p of Object.values((s.properties as Record<string, Record<string, unknown>>) ?? {})) walk(p);
      }
      if (s.type === "array" || (Array.isArray(s.type) && s.type.includes("array")))
        walk(s.items as Record<string, unknown>);
    };
    for (const t of AI_TOOL_SPECS) walk(t.inputSchema);
  });
  test("no tool takes a tenant id", () => {
    const text = JSON.stringify(AI_TOOL_SPECS);
    for (const banned of ["restaurant", "customer_id", "conversation", "phone", "price"])
      expect(text).not.toContain(`"${banned}`);
  });
});
