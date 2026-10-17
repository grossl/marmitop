// ScriptedAssistantModel: a scripted AssistantModel for tests and local development (FR-198).

import type {
  AssistantModel,
  AssistantModelError,
  AssistantRequest,
  AssistantResponse,
} from "../ports/assistant-model";

export type ScriptedStep =
  | { readonly text: string }
  | { readonly tools: readonly { readonly name: string; readonly input: unknown }[] }
  | { readonly stop: "refusal" | "max_tokens" }
  | { readonly error: AssistantModelError };

const USAGE = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 };

export class ScriptedAssistantModel implements AssistantModel {
  readonly modelName = "scripted";
  readonly requests: AssistantRequest[] = [];
  private readonly script: ScriptedStep[];
  private nextId = 1;

  constructor(script: ScriptedStep[]) {
    this.script = [...script];
  }

  /** Appends steps, for tests that script one turn at a time. */
  push(...steps: ScriptedStep[]): void {
    this.script.push(...steps);
  }

  async respond(request: AssistantRequest): Promise<AssistantResponse> {
    this.requests.push(request);
    const step = this.script.shift();
    if (step === undefined) throw new Error("ScriptedAssistantModel: script exhausted");
    if ("error" in step) throw step.error;
    if ("stop" in step) return { content: [], stopReason: step.stop, usage: USAGE, model: this.modelName };
    if ("text" in step) {
      return {
        content: [{ type: "text", text: step.text }],
        stopReason: "end_turn",
        usage: USAGE,
        model: this.modelName,
      };
    }
    return {
      content: step.tools.map((t) => ({
        type: "tool_use" as const,
        id: `toolu_${this.nextId++}`,
        name: t.name,
        input: t.input,
      })),
      stopReason: "tool_use",
      usage: USAGE,
      model: this.modelName,
    };
  }
}
