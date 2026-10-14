"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Video, MoreVertical, Send, Paperclip, Smile, ShoppingBag } from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Textarea } from "@mt/ui/components/textarea";
import { ScrollArea } from "@mt/ui/components/scroll-area";
import { Badge } from "@mt/ui/components/badge";
import { cn } from "@mt/ui/lib/utils";
import { type Contact, type Message } from "@/lib/marmita-data";

interface ChatPanelProps {
  contact: Contact;
  messages: Message[];
  onSendMessage: (text: string) => void;
  onOrderClick: (orderId: string) => void;
  onCreateOrder?: () => void;
  highlightedOrderId?: string;
}

export function ChatPanel({
  contact,
  messages,
  onSendMessage,
  onOrderClick,
  onCreateOrder,
  highlightedOrderId,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setText("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-card border-b border-border shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {contact.avatar}
            </div>
            {contact.online && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-card" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">{contact.name}</p>
            <p className="text-xs text-muted-foreground">
              {contact.online ? "Online agora" : `Visto por último às ${contact.lastTime}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onCreateOrder && (
            <Button variant="outline" size="sm" className="mr-1 h-8 gap-1.5 text-xs" onClick={onCreateOrder}>
              <ShoppingBag className="h-3.5 w-3.5" /> Novo pedido
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Phone className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Video className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="flex flex-col gap-3 max-w-2xl mx-auto">
          {/* Date divider */}
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground bg-background px-2">Hoje</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col max-w-[75%]",
                msg.from === "restaurant" ? "self-end items-end" : "self-start items-start"
              )}
            >
              {/* Order tag */}
              {msg.orderId && (
                <button
                  onClick={() => onOrderClick(msg.orderId!)}
                  className={cn(
                    "flex items-center gap-1.5 mb-1 text-[11px] font-medium px-2 py-1 rounded-full transition-colors",
                    highlightedOrderId === msg.orderId
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent/60 text-accent-foreground hover:bg-accent"
                  )}
                >
                  <ShoppingBag className="w-3 h-3" />
                  Pedido #{msg.orderId}
                </button>
              )}

              <div
                className={cn(
                  "px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm",
                  msg.from === "restaurant"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-card text-foreground rounded-tl-sm border border-border"
                )}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-muted-foreground mt-1 px-1">{msg.time}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="px-4 py-3 bg-card border-t border-border shrink-0">
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
              <Paperclip className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
              <Smile className="w-4 h-4" />
            </Button>
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Digite uma mensagem... (Enter para enviar)"
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm py-2.5 bg-background border-border focus-visible:ring-primary leading-relaxed"
          />

          <Button
            onClick={handleSend}
            disabled={!text.trim()}
            size="icon"
            className="h-10 w-10 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
