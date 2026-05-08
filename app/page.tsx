"use client";

import { useState } from "react";
import { ContactsSidebar } from "@/components/contacts-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { NavSidebar } from "@/components/nav-sidebar";
import { OrdersPage } from "@/components/orders-page";
import { ContactsPage } from "@/components/contacts-page";
import { ReportsPage } from "@/components/reports-page";
import { CardapioPage } from "@/components/cardapio-page";
import {
  contacts,
  messages as initialMessages,
  type Message,
  type Section,
} from "@/lib/marmita-data";

export default function MarmitaChatPage() {
  const [section, setSection] = useState<Section>("mensagens");

  // Chat state
  const [selectedContactId, setSelectedContactId] = useState("1");
  const [messages, setMessages] = useState(initialMessages);

  const selectedContact = contacts.find((c) => c.id === selectedContactId)!;
  const currentMessages = messages[selectedContactId] ?? [];

  // Badge counts
  const unreadCount = contacts.reduce((s, c) => s + c.unread, 0);

  const handleSendMessage = (text: string) => {
    const newMsg: Message = {
      id: `m${Date.now()}`,
      from: "restaurant",
      text,
      time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => ({
      ...prev,
      [selectedContactId]: [...(prev[selectedContactId] ?? []), newMsg],
    }));
  };

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Primary nav */}
      <NavSidebar
        active={section}
        onSelect={setSection}
        unreadCount={unreadCount}
      />

      {/* Section views */}
      {section === "mensagens" && (
        <>
          <ContactsSidebar
            contacts={contacts}
            selectedId={selectedContactId}
            onSelect={setSelectedContactId}
          />
          <ChatPanel
            contact={selectedContact}
            messages={currentMessages}
            onSendMessage={handleSendMessage}
            onOrderClick={() => {}}
          />
        </>
      )}

      {section === "pedidos" && (
        <div className="flex-1 overflow-hidden">
          <OrdersPage />
        </div>
      )}

      {section === "contatos" && (
        <div className="flex-1 overflow-hidden">
          <ContactsPage />
        </div>
      )}

      {section === "cardapio" && (
        <div className="flex-1 overflow-hidden">
          <CardapioPage />
        </div>
      )}

      {section === "relatorios" && (
        <div className="flex-1 overflow-hidden">
          <ReportsPage />
        </div>
      )}
    </main>
  );
}
