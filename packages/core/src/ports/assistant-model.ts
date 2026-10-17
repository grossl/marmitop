// AssistantModel port (ADR-025, FR-198). Adapters: AnthropicAssistantModel (apps/worker), ScriptedAssistantModel.

export interface AssistantTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface AssistantToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface AssistantToolResultBlock {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
}

export type AssistantBlock = AssistantTextBlock | AssistantToolUseBlock | AssistantToolResultBlock;

export interface AssistantMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly AssistantBlock[];
  /** Adapter-owned content of an assistant turn from this loop (thinking blocks). Sent back unchanged. */
  readonly raw?: unknown;
}

export interface AssistantToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface AssistantRequest {
  readonly instructions: string;
  readonly restaurantBlock: string;
  readonly tools: readonly AssistantToolSpec[];
  readonly messages: readonly AssistantMessage[];
  readonly turnContext: string;
}

export type AssistantStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface AssistantUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface AssistantResponse {
  readonly content: readonly (AssistantTextBlock | AssistantToolUseBlock)[];
  readonly stopReason: AssistantStopReason;
  readonly usage: AssistantUsage;
  readonly model: string;
  readonly raw?: unknown;
}

export class AssistantModelError extends Error {
  constructor(
    message: string,
    /** True for 429, 5xx, timeouts, and connection errors. */
    readonly retryable: boolean,
    /** Short code for `ai_runs.error_code`, for example `rate_limited`. Never contains request data. */
    readonly code: string,
  ) {
    super(message);
    this.name = "AssistantModelError";
  }
}

export interface AssistantModel {
  readonly modelName: string;
  respond(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse>;
}
