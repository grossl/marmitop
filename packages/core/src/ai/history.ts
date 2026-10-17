// Message rows → model turns (12.ai-order-assistant.md "Request" item 4). Pure.

import type { AssistantMessage } from "../ports/assistant-model";
import { AI_HISTORY_WINDOW } from "./turn-rules";

export interface HistoryRow {
  readonly direction: "in" | "out";
  readonly body: string;
  readonly automaticKind: string | null;
  /** True when a dashboard user sent it (`messages.sent_by` is not null). */
  readonly sentByUser: boolean;
  readonly aiRunId: string | null;
}

function textOf(r: HistoryRow): string {
  if (r.direction === "in") return r.body;
  if (r.aiRunId !== null) return r.body;
  if (r.automaticKind !== null) return `[mensagem automática] ${r.body}`;
  return `[atendente] ${r.body}`;
}

export function historyToMessages(rows: readonly HistoryRow[]): AssistantMessage[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const r of rows.slice(-AI_HISTORY_WINDOW)) {
    const role = r.direction === "in" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.text = `${last.text}\n${textOf(r)}`;
    else out.push({ role, text: textOf(r) });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out.map((m) => ({ role: m.role, content: [{ type: "text", text: m.text }] }));
}
