"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { ContactsSidebar } from "@/components/contacts-sidebar";
import { contacts, messages as initialMessages, type Message } from "@/lib/marmita-data";

// The messages screen as it was in app/page.tsx, moved to its own route
// (ADR-004). Still mock data; T4.12 wires stored conversations.
export function MessagesScreen() {
  const router = useRouter();
  const [selectedContactId, setSelectedContactId] = useState("1");
  const [messages, setMessages] = useState(initialMessages);

  const selectedContact = contacts.find((c) => c.id === selectedContactId)!;
  const currentMessages = messages[selectedContactId] ?? [];

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
    <>
      <ContactsSidebar contacts={contacts} selectedId={selectedContactId} onSelect={setSelectedContactId} />
      <ChatPanel
        contact={selectedContact}
        messages={currentMessages}
        onSendMessage={handleSendMessage}
        onOrderClick={() => {}}
        onCreateOrder={() => router.push("/novo-pedido")}
      />
    </>
  );
}
