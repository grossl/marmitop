// Worker-only AI configuration (FR-198, 11.operations.md). The dashboard and apps/api never read it.

export interface AiConfig {
  readonly apiKey: string | null;
  readonly model: string;
  readonly effort: "low" | "medium" | "high";
}

const EFFORTS = new Set(["low", "medium", "high"]);

export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const effort = env.MT_AI_EFFORT ?? "low";
  return {
    apiKey: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY : null,
    model: env.MT_AI_MODEL || "claude-haiku-5-5",
    effort: (EFFORTS.has(effort) ? effort : "low") as AiConfig["effort"],
  };
}
