// covers FR-198
import { describe, expect, test } from "bun:test";

import { readAiConfig } from "./config";

describe("readAiConfig", () => {
  test("defaults", () => {
    expect(readAiConfig({})).toEqual({ apiKey: null, model: "claude-haiku-5-5", effort: "low" });
  });
  test("overrides; an empty key means fake mode", () => {
    expect(readAiConfig({ ANTHROPIC_API_KEY: "", MT_AI_MODEL: "claude-sonnet-5-5", MT_AI_EFFORT: "medium" })).toEqual({
      apiKey: null,
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
  });
  test("an unknown effort falls back to low", () => {
    expect(readAiConfig({ MT_AI_EFFORT: "turbo" }).effort).toBe("low");
  });
  test("a whitespace-only key means fake mode; a key is trimmed", () => {
    expect(readAiConfig({ ANTHROPIC_API_KEY: "  \n" }).apiKey).toBeNull();
    expect(readAiConfig({ ANTHROPIC_API_KEY: " k-1 \n" }).apiKey).toBe("k-1");
  });
});
