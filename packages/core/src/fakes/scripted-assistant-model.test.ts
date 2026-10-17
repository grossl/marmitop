// covers FR-198
import { describe, expect, test } from "bun:test";

import { AssistantModelError, type AssistantRequest } from "../ports/assistant-model";
import { ScriptedAssistantModel } from "./scripted-assistant-model";

const req: AssistantRequest = { instructions: "i", restaurantBlock: "r", tools: [], messages: [], turnContext: "c" };

describe("ScriptedAssistantModel", () => {
  test("returns scripted steps in order and records each request", async () => {
    const model = new ScriptedAssistantModel([
      { tools: [{ name: "update_cart", input: { fulfillment: "pickup" } }] },
      { text: "Pronto!" },
    ]);
    const first = await model.respond(req);
    expect(first.stopReason).toBe("tool_use");
    expect(first.content[0]).toMatchObject({ type: "tool_use", name: "update_cart", input: { fulfillment: "pickup" } });
    const second = await model.respond(req);
    expect(second).toMatchObject({ stopReason: "end_turn", content: [{ type: "text", text: "Pronto!" }] });
    expect(model.requests).toHaveLength(2);
  });

  test("tool ids are unique across steps", async () => {
    const model = new ScriptedAssistantModel([
      {
        tools: [
          { name: "a", input: {} },
          { name: "b", input: {} },
        ],
      },
      { tools: [{ name: "c", input: {} }] },
    ]);
    const ids = [...(await model.respond(req)).content, ...(await model.respond(req)).content].map((b) =>
      b.type === "tool_use" ? b.id : "",
    );
    expect(new Set(ids).size).toBe(3);
  });

  test("a stop step and an error step", async () => {
    const model = new ScriptedAssistantModel([
      { stop: "refusal" },
      { error: new AssistantModelError("down", true, "overloaded") },
    ]);
    expect((await model.respond(req)).stopReason).toBe("refusal");
    await expect(model.respond(req)).rejects.toMatchObject({ retryable: true, code: "overloaded" });
  });

  test("an exhausted script throws", async () => {
    await expect(new ScriptedAssistantModel([]).respond(req)).rejects.toThrow("script exhausted");
  });
});
