// covers FR-198
import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";

import { AnthropicAssistantModel } from "./anthropic-model";

const req = {
  instructions: "INSTR",
  restaurantBlock: "REST",
  tools: [
    {
      name: "place_order",
      description: "d",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  ],
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "oi" }] }],
  turnContext: "CTX",
};

function stub(response: unknown, sink: unknown[] = []): Anthropic {
  return {
    messages: {
      create: async (body: unknown) => {
        sink.push(body);
        return response;
      },
    },
  } as unknown as Anthropic;
}

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 };

describe("AnthropicAssistantModel", () => {
  test("builds the request: cached system blocks, strict tools, effort, final system message", async () => {
    const sent: Record<string, unknown>[] = [];
    const model = new AnthropicAssistantModel({
      client: stub(
        { content: [{ type: "text", text: "Oi!" }], stop_reason: "end_turn", usage, model: "claude-haiku-5-5" },
        sent,
      ),
      model: "claude-haiku-5-5",
      effort: "low",
    });
    await model.respond(req);
    const body = sent[0]!;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.system).toEqual([
      { type: "text", text: "INSTR" },
      { type: "text", text: "REST", cache_control: { type: "ephemeral" } },
    ]);
    expect((body.tools as { strict: boolean }[])[0]?.strict).toBe(true);
    expect((body.messages as { role: string; content: unknown }[]).at(-1)).toEqual({ role: "system", content: "CTX" });
    expect(body).not.toHaveProperty("fallbacks");
  });

  test("maps tool_use, refusal, and usage", async () => {
    const toolUse = new AnthropicAssistantModel({
      client: stub({
        content: [
          { type: "thinking", thinking: "", signature: "s" },
          { type: "tool_use", id: "t1", name: "place_order", input: {} },
        ],
        stop_reason: "tool_use",
        usage,
        model: "m",
      }),
      model: "m",
      effort: "low",
    });
    const r = await toolUse.respond(req);
    expect(r.stopReason).toBe("tool_use");
    expect(r.content).toEqual([{ type: "tool_use", id: "t1", name: "place_order", input: {} }]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 0 });
    expect(Array.isArray(r.raw)).toBe(true);

    const refusal = new AnthropicAssistantModel({
      client: stub({ content: [], stop_reason: "refusal", usage, model: "m" }),
      model: "m",
      effort: "low",
    });
    expect((await refusal.respond(req)).stopReason).toBe("refusal");
  });

  test("an assistant turn with raw content is sent back unchanged", async () => {
    const sent: Record<string, unknown>[] = [];
    const raw = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "tool_use", id: "t1", name: "place_order", input: {} },
    ];
    const model = new AnthropicAssistantModel({
      client: stub({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage, model: "m" }, sent),
      model: "m",
      effort: "low",
    });
    await model.respond({
      ...req,
      messages: [
        ...req.messages,
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "place_order", input: {} }], raw },
        { role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "{}", isError: false }] },
      ],
    });
    const msgs = sent[0]!.messages as { role: string; content: unknown }[];
    expect(msgs.find((m) => m.role === "assistant")?.content).toEqual(raw);
    expect(msgs.at(-1)?.role).toBe("user");
  });

  test("SDK errors map to AssistantModelError", async () => {
    const failing = {
      messages: {
        create: async () => {
          throw new Anthropic.RateLimitError(429, undefined, "rate", new Headers());
        },
      },
    } as unknown as Anthropic;
    const model = new AnthropicAssistantModel({ client: failing, model: "m", effort: "low" });
    await expect(model.respond(req)).rejects.toMatchObject({ retryable: true, code: "rate_limited" });
  });
});
