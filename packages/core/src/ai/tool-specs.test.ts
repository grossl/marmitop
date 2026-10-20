// covers FR-184, FR-195
import { describe, expect, test } from "bun:test";

import { AI_TOOL_NAMES, AI_TOOL_SPECS } from "./tool-specs";

describe("AI_TOOL_SPECS", () => {
  test("one spec per tool name, in a fixed order", () => {
    expect(AI_TOOL_SPECS.map((t) => t.name)).toEqual([...AI_TOOL_NAMES]);
  });
  test("strict-ready: every object schema lists all properties as required and forbids extras", () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === "object" || (Array.isArray(s.type) && s.type.includes("object"))) {
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

  test("uses no keyword that strict tool use rejects", () => {
    const banned = ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "multipleOf"];
    const walk = (node: unknown, path: string): string[] => {
      if (Array.isArray(node)) return node.flatMap((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return [];
      return Object.entries(node).flatMap(([k, v]) => [
        ...(banned.includes(k) ? [`${path}.${k}`] : []),
        ...walk(v, `${path}.${k}`),
      ]);
    };
    const found = AI_TOOL_SPECS.flatMap((t) => walk(t.inputSchema, t.name));
    expect(found).toEqual([]);
  });

  // The Messages API rejects `enum` next to a type array ("Enum value 'pickup' does not match
  // declared type"). A nullable enum must be `anyOf: [{ type, enum }, { type: "null" }]`.
  test("no enum sits next to a type array", () => {
    const walk = (node: unknown, path: string): string[] => {
      if (Array.isArray(node)) return node.flatMap((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return [];
      const o = node as Record<string, unknown>;
      const here = "enum" in o && Array.isArray(o.type) ? [path] : [];
      return [...here, ...Object.entries(o).flatMap(([k, v]) => walk(v, `${path}.${k}`))];
    };
    expect(AI_TOOL_SPECS.flatMap((t) => walk(t.inputSchema, t.name))).toEqual([]);
  });

  test("update_cart.fulfillment is pickup, delivery, or null", () => {
    const cart = AI_TOOL_SPECS.find((t) => t.name === "update_cart");
    const props = cart?.inputSchema.properties as Record<string, unknown>;
    expect(props.fulfillment).toMatchObject({
      anyOf: [{ type: "string", enum: ["pickup", "delivery"] }, { type: "null" }],
    });
  });
});
