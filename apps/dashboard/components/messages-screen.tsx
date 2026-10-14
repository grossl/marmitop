"use client";

import type { ConversationDetail, ConversationSummary } from "@mt/http";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { ContactsSidebar } from "@/components/contacts-sidebar";
import { useRealtimeTable } from "@/lib/realtime";

interface MessagesScreenProps {
  restaurantId: string;
  restaurantName: string;
  conversations: ConversationSummary[];
  detail: ConversationDetail | null;
  /** Dev-only "Simular mensagem do cliente" control (ADR-002). */
  canSimulate: boolean;
}

// The messages screen (ADR-004). The route's Server Component loads the
// conversations and the open one; Realtime events trigger router.refresh()
// (FR-015), never a payload merge.
export function MessagesScreen({ restaurantId, restaurantName, conversations, detail, canSimulate }: MessagesScreenProps) {
  const router = useRouter();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 250);
  }, [router]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useRealtimeTable("messages", restaurantId, refresh);
  useRealtimeTable("conversations", restaurantId, refresh);

  return (
    <>
      <ContactsSidebar
        restaurantName={restaurantName}
        conversations={conversations}
        selectedId={detail?.conversation.id ?? null}
        onSelect={(id) => router.push(`/messages?c=${id}`)}
        canSimulate={canSimulate}
        onSimulated={(conversationId) => router.push(`/messages?c=${conversationId}`)}
      />
      {detail ? (
        <ChatPanel key={detail.conversation.id} detail={detail} onChanged={() => router.refresh()} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
          Nenhuma conversa selecionada.
        </div>
      )}
    </>
  );
}
