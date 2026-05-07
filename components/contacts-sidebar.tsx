"use client";

import { useState } from "react";
import { Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type Contact } from "@/lib/marmita-data";

interface ContactsSidebarProps {
  contacts: Contact[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function ContactsSidebar({ contacts, selectedId, onSelect }: ContactsSidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  return (
    <aside className="flex flex-col w-72 shrink-0 bg-sidebar border-r border-sidebar-border">
      {/* Header */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
            <Store className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-sidebar-foreground leading-tight">MarmitaChat</p>
            <p className="text-xs text-sidebar-foreground/50 leading-tight">Restaurante da Vó Maria</p>
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

      {/* Contact list */}
      <ScrollArea className="flex-1">
        <div className="py-2">
          <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            Conversas
          </p>
          {filtered.map((contact) => (
            <button
              key={contact.id}
              onClick={() => onSelect(contact.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                selectedId === contact.id
                  ? "bg-sidebar-accent"
                  : "hover:bg-sidebar-accent/60"
              )}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                    selectedId === contact.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-sidebar-border text-sidebar-foreground/80"
                  )}
                >
                  {contact.avatar}
                </div>
                {contact.online && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-sidebar" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-sidebar-foreground truncate">
                    {contact.name}
                  </span>
                  <span className="text-[10px] text-sidebar-foreground/40 shrink-0 ml-1">
                    {contact.lastTime}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs text-sidebar-foreground/50 truncate leading-relaxed">
                    {contact.lastMessage}
                  </p>
                  {contact.unread > 0 && (
                    <Badge className="shrink-0 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground rounded-full">
                      {contact.unread}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-sidebar-foreground/40">
              Nenhum contato encontrado
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
