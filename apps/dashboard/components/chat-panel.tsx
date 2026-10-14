"use client";

import type { ConversationDetail, MessageDto } from "@mt/http";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Phone, Video, MoreVertical, Send, Paperclip, Smile, ShoppingBag, RotateCw, AlertCircle } from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Textarea } from "@mt/ui/components/textarea";
import { ScrollArea } from "@mt/ui/components/scroll-area";
import { cn } from "@mt/ui/lib/utils";

import { retryMessageAction, sendMessageAction } from "@/app/(app)/mensagens/actions";
import { CustomerOrdersPanel } from "@/components/customer-orders-panel";
import { formatDate, formatTime, initials } from "@/components/messaging-format";

interface ChatPanelProps {
  detail: ConversationDetail;
  /** Called after a send or retry succeeds, so the screen reloads its data. */
  onChanged: () => void;
}

const STATUS_LABEL: Record<MessageDto["status"], string> = {
  pending: "Enviando...",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
};

export function ChatPanel({ detail, onChanged }: ChatPanelProps) {
  const { conversation, messages, orders, windowOpen } = detail;
  const [text, setText] = useState("");
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !windowOpen) return;
    start(async () => {
      const result = await sendMessageAction({ conversationId: conversation.id, body: trimmed });
      if (!result.ok) {
        toast.error(result.error.message);
        if (result.error.code === "outside_service_window") onChanged();
        return;
      }
      setText("");
      onChanged();
    });
  };

  const handleRetry = (messageId: string) =>
    start(async () => {
      const result = await retryMessageAction({ messageId });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      onChanged();
    });

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-1 min-w-0">
      <div className="flex flex-col flex-1 min-w-0 bg-background">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 bg-card border-b border-border shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {initials(conversation.customerName)}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">{conversation.customerName}</p>
              <p className="text-xs text-muted-foreground">{conversation.customerPhone}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="mr-1 h-8 gap-1.5 text-xs" asChild>
              <Link href={`/novo-pedido?conversation=${conversation.id}&customer=${conversation.customerId}`}>
                <ShoppingBag className="h-3.5 w-3.5" /> Criar pedido
              </Link>
            </Button>
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
            {messages.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
            )}
            {messages.map((msg, index) => {
              const outbound = msg.direction === "out";
              const previous = messages[index - 1];
              const newDay = !previous || formatDate(previous.createdAt) !== formatDate(msg.createdAt);
              return (
                <div key={msg.id} className="contents">
                  {newDay && (
                    <div className="flex items-center gap-3 my-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[11px] text-muted-foreground bg-background px-2">
                        {formatDate(msg.createdAt)}
                      </span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  <div className={cn("flex flex-col max-w-[75%]", outbound ? "self-end items-end" : "self-start items-start")}>
                    {/* Order tag (FR-016) */}
                    {msg.orderId && msg.orderCode && (
                      <button
                        onClick={() => setHighlightedOrderId(msg.orderId)}
                        className={cn(
                          "flex items-center gap-1.5 mb-1 text-[11px] font-medium px-2 py-1 rounded-full transition-colors",
                          highlightedOrderId === msg.orderId
                            ? "bg-primary text-primary-foreground"
                            : "bg-accent/60 text-accent-foreground hover:bg-accent",
                        )}
                      >
                        <ShoppingBag className="w-3 h-3" />
                        Pedido #{msg.orderCode}
                      </button>
                    )}

                    <div
                      className={cn(
                        "px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words",
                        outbound
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-card text-foreground rounded-tl-sm border border-border",
                      )}
                    >
                      {msg.body}
                    </div>
                    <div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                      <span>{formatTime(msg.createdAt)}</span>
                      {outbound && (
                        <span className={cn(msg.status === "failed" && "font-medium text-destructive")}>
                          {STATUS_LABEL[msg.status]}
                        </span>
                      )}
                      {outbound && msg.status === "failed" && (
                        <button
                          onClick={() => handleRetry(msg.id)}
                          disabled={pending || !windowOpen}
                          className="inline-flex items-center gap-1 font-medium text-destructive hover:underline disabled:opacity-50"
                        >
                          <RotateCw className="h-3 w-3" /> Tentar de novo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="px-4 py-3 bg-card border-t border-border shrink-0">
          {!windowOpen && (
            <p className="max-w-2xl mx-auto mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              Fora da janela de 24h: o cliente precisa escrever de novo para você responder.
            </p>
          )}
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
              disabled={!windowOpen}
              maxLength={4096}
              placeholder={windowOpen ? "Digite uma mensagem... (Enter para enviar)" : "Fora da janela de 24h"}
              rows={1}
              className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm py-2.5 bg-background border-border focus-visible:ring-primary leading-relaxed"
            />

            <Button
              onClick={handleSend}
              disabled={!windowOpen || pending || !text.trim()}
              size="icon"
              className="h-10 w-10 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <CustomerOrdersPanel orders={orders} highlightedOrderId={highlightedOrderId} />
    </div>
  );
}
