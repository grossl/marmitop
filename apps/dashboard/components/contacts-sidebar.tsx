"use client";

import type { ConversationSummary } from "@mt/http";
import { useMemo, useState } from "react";
import { Search, Store } from "lucide-react";
import { Input } from "@mt/ui/components/input";
import { Badge } from "@mt/ui/components/badge";
import { ScrollArea } from "@mt/ui/components/scroll-area";
import { cn } from "@mt/ui/lib/utils";

import { formatListTime, initials } from "@/components/messaging-format";
import { SimulateInboundForm } from "@/components/simulate-inbound-form";

interface ContactsSidebarProps {
  restaurantName: string;
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canSimulate?: boolean;
  onSimulated?: (conversationId: string) => void;
}

// The conversation list (FR-010, FR-011): newest message first (the server
// orders it), search by name, phone, or preview.
export function ContactsSidebar({
  restaurantName,
  conversations,
  selectedId,
  onSelect,
  canSimulate = false,
  onSimulated,
}: ContactsSidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter(
      (c) =>
        c.customerName.toLowerCase().includes(term) ||
        c.customerPhone.includes(term) ||
        (c.lastMessagePreview ?? "").toLowerCase().includes(term),
    );
  }, [conversations, search]);

  return (
    <aside className="flex flex-col w-72 shrink-0 bg-sidebar border-r border-sidebar-border">
      {/* Header */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
            <Store className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground leading-tight">Marmitop</p>
            <p className="text-xs text-sidebar-foreground/50 leading-tight">{restaurantName}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sidebar-foreground/40" />
          <Input
            placeholder="Buscar clientes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm bg-sidebar-accent border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-primary"
          />
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="py-2">
          <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            Conversas
          </p>
          {filtered.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                selectedId === conversation.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
              )}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                    selectedId === conversation.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-sidebar-border text-sidebar-foreground/80",
                  )}
                >
                  {initials(conversation.customerName)}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {conversation.customerName}
                  </span>
                  <span className="text-[10px] text-sidebar-foreground/40 shrink-0 ml-1">
                    {formatListTime(conversation.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs text-sidebar-foreground/50 truncate leading-relaxed">
                    {conversation.lastMessagePreview ?? "Sem mensagens"}
                  </p>
                  {conversation.unreadCount > 0 && (
                    <Badge className="shrink-0 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground rounded-full">
                      {conversation.unreadCount}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-sidebar-foreground/40">
              {conversations.length === 0 ? "Nenhuma conversa ainda" : "Nenhum contato encontrado"}
            </p>
          )}
        </div>
      </ScrollArea>

      {canSimulate && onSimulated && (
        <SimulateInboundForm knownPhones={conversations.map((c) => c.customerPhone)} onSimulated={onSimulated} />
      )}
    </aside>
  );
}
