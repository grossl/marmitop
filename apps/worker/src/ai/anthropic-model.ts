// AnthropicAssistantModel (ADR-025 Decision 3, FR-198): the Claude Messages API behind AssistantModel.
// Haiku 5.5 has no server-side refusal fallback; a refusal pauses the conversation (FR-191).

import Anthropic from "@anthropic-ai/sdk";
import {
  type AssistantBlock,
  type AssistantModel,
  AssistantModelError,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantStopReason,
} from "@mt/core";

import type { AiConfig } from "./config";

function toApiContent(blocks: readonly AssistantBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((b): Anthropic.ContentBlockParam => {
    if (b.type === "text") return { type: "text", text: b.text };
    if (b.type === "tool_use")
      return { type: "tool_use", id: b.id, name: b.name, input: b.input as Record<string, unknown> };
    return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
  });
}

function stopReasonOf(r: string | null): AssistantStopReason {
  return r === "end_turn" || r === "tool_use" || r === "max_tokens" || r === "refusal" ? r : "other";
}

function mapError(error: unknown): AssistantModelError {
  if (error instanceof AssistantModelError) return error;
  // The turn budget (AI_TURN_BUDGET_MS) or a worker shutdown aborted the call. runAiTurn checks which
  // signal fired: a shutdown retries, a budget abort stays `deadline` and is not retried.
  if (error instanceof Anthropic.APIUserAbortError) return new AssistantModelError("aborted", false, "deadline");
  if (error instanceof Anthropic.RateLimitError) return new AssistantModelError("rate limited", true, "rate_limited");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AssistantModelError("timeout", true, "timeout");
  if (error instanceof Anthropic.APIConnectionError) return new AssistantModelError("connection", true, "connection");
  if (error instanceof Anthropic.AuthenticationError) return new AssistantModelError("auth", false, "unauthorized");
  if (error instanceof Anthropic.BadRequestError) return new AssistantModelError("bad request", false, "bad_request");
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 529) return new AssistantModelError("overloaded", true, "overloaded");
    if (status >= 500) return new AssistantModelError("server error", true, "server_error");
    return new AssistantModelError("api error", false, `http_${status}`);
  }
  return new AssistantModelError("unknown", false, "internal_error");
}

export class AnthropicAssistantModel implements AssistantModel {
  readonly modelName: string;
  private readonly client: Anthropic;
  private readonly effort: AiConfig["effort"];

  constructor(opts: { readonly client: Anthropic; readonly model: string; readonly effort: AiConfig["effort"] }) {
    this.client = opts.client;
    this.modelName = opts.model;
    this.effort = opts.effort;
  }

  static fromConfig(config: AiConfig & { readonly apiKey: string }): AnthropicAssistantModel {
    return new AnthropicAssistantModel({
      client: new Anthropic({ apiKey: config.apiKey, timeout: 20_000, maxRetries: 2 }),
      model: config.model,
      effort: config.effort,
    });
  }

  async respond(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
    // History turns come first; the loop appends assistant/tool turns after them. The turn context
    // goes right after the last history turn as a mid-conversation system message.
    const firstLoopTurn = request.messages.findIndex(
      (m) => m.raw !== undefined || m.content.some((b) => b.type === "tool_result"),
    );
    const historyLength = firstLoopTurn === -1 ? request.messages.length : firstLoopTurn;
    // `raw` is this adapter's own `res.content` from an earlier loop request (thinking blocks included).
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
      role: m.role,
      content: m.raw !== undefined ? (m.raw as Anthropic.ContentBlockParam[]) : toApiContent(m.content),
    }));
    // A system message must follow a user turn, and a final assistant turn would be a prefill.
    // runAiTurn removes trailing assistant turns from the history (splitTrailingAssistant).
    if (request.messages[historyLength - 1]?.role !== "user") {
      throw new AssistantModelError("history must end with a user turn", false, "bad_history");
    }
    messages.splice(historyLength, 0, { role: "system", content: request.turnContext });

    try {
      const res = await this.client.messages.create(
        {
          model: this.modelName,
          max_tokens: 2000,
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort },
          system: [
            { type: "text", text: request.instructions },
            { type: "text", text: request.restaurantBlock, cache_control: { type: "ephemeral" } },
          ],
          tools: request.tools.map(
            (t): Anthropic.Tool => ({
              name: t.name,
              description: t.description,
              // AI_TOOL_SPECS schemas are JSON Schema objects (`type: "object"`); the port types them loosely.
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              strict: true,
            }),
          ),
          messages,
        },
        { signal },
      );
      return {
        content: res.content.flatMap((b): AssistantResponse["content"][number][] =>
          b.type === "text"
            ? [{ type: "text", text: b.text }]
            : b.type === "tool_use"
              ? [{ type: "tool_use", id: b.id, name: b.name, input: b.input }]
              : [],
        ),
        stopReason: stopReasonOf(res.stop_reason),
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        },
        model: res.model,
        raw: res.content,
      };
    } catch (error) {
      throw mapError(error);
    }
  }
}
