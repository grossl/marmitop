import { AppError } from "@mt/core";
import { type ConversationDetail, getConversation, listConversations, listMemberships } from "@mt/http";
import { uuidSchema } from "@mt/schemas";
import type { Metadata } from "next";

import { MessagesScreen } from "@/components/messages-screen";
import { requireDeps } from "@/lib/server/deps";
import { getSessionUser, requireScreen } from "@/lib/server/session";

export const metadata: Metadata = { title: "Mensagens — Marmitop" };

// Role gate on the server (FR-005): a screen the role cannot open is a 404.
// Data loads here (ADR-004). `?c=<conversationId>` selects a conversation;
// loading it marks it read (FR-012). The client refreshes on Realtime events.
export default async function MessagesRoute({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requireScreen("messages");
  const deps = requireDeps();
  const { c } = await searchParams;

  const { items } = await listConversations(deps, ctx, { limit: 100 });
  const selectedId = c && uuidSchema.safeParse(c).success ? c : (items[0]?.id ?? null);

  let detail: ConversationDetail | null = null;
  if (selectedId) {
    try {
      detail = await getConversation(deps, ctx, { conversationId: selectedId });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "not_found")) throw error;
    }
  }

  const user = await getSessionUser();
  const memberships = user ? await listMemberships(deps, user.id) : [];
  const restaurantName = memberships.find((m) => m.restaurantId === ctx.restaurantId)?.restaurantName ?? "Marmitop";

  // The list was read before the open marked it read; show the open one as read.
  const conversations = items.map((i) => (detail && i.id === detail.conversation.id ? { ...i, unreadCount: 0 } : i));

  return (
    <MessagesScreen
      restaurantId={ctx.restaurantId}
      restaurantName={restaurantName}
      conversations={conversations}
      detail={detail}
      canSimulate={process.env.NODE_ENV !== "production" && ctx.role === "admin"}
    />
  );
}
