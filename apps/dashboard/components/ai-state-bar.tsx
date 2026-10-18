"use client";

// "IA ativa" / "IA pausada · motivo" with Pausar / Retomar (FR-189, FR-190).

import type { ConversationSummary } from "@mt/http";
import { Button } from "@mt/ui/components/button";
import { Bot } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { setConversationAiModeAction } from "@/app/(app)/messages/actions";

const REASON: Record<string, string> = {
  attendant: "equipe respondeu",
  manual: "pausada pela equipe",
  customer_request: "cliente pediu atendente",
  complaint: "reclamação",
  order_change: "alteração de pedido",
  status_question: "pergunta sobre pedido",
  unsupported_media: "mídia não suportada",
  unclear: "não entendeu",
  other: "outro motivo",
  model: "a IA não conseguiu responder",
  stale: "resposta atrasada",
  quota: "limite do plano atingido",
  cap: "limite máximo atingido",
};

export function AiStateBar({ conversation, onChanged }: { conversation: ConversationSummary; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const paused = conversation.aiMode === "paused";
  const toggle = () =>
    start(async () => {
      const result = await setConversationAiModeAction({
        conversationId: conversation.id,
        mode: paused ? "auto" : "paused",
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onChanged();
    });
  return (
    <div className="flex items-center gap-2 text-xs">
      <Bot className={paused ? "h-4 w-4 text-muted-foreground" : "h-4 w-4 text-primary"} />
      <span className={paused ? "text-muted-foreground" : "font-medium text-primary"}>
        {paused ? `IA pausada · ${REASON[conversation.aiPauseReason ?? ""] ?? "pausada"}` : "IA ativa"}
      </span>
      {paused && conversation.aiPauseNote && (
        <span className="text-muted-foreground">— {conversation.aiPauseNote}</span>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pending} onClick={toggle}>
        {paused ? "Retomar" : "Pausar"}
      </Button>
    </div>
  );
}
