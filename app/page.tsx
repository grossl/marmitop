"use client";

import { useRef, useState } from "react";
import { ContactsSidebar } from "@/components/contacts-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { OrdersPanel } from "@/components/orders-panel";
import {
  contacts,
  messages as initialMessages,
  orders as initialOrders,
  type Message,
  type Order,
  type OrderStatus,
} from "@/lib/marmita-data";

export default function MarmitaChatPage() {
  const [selectedContactId, setSelectedContactId] = useState("1");
  const [messages, setMessages] = useState(initialMessages);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | undefined>();

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const handleOrderClick = (orderId: string) => {
    setHighlightedOrderId(orderId);

    // Scroll to order card
    setTimeout(() => {
      const el = cardRefs.current[orderId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);

    // Remove highlight after 3s
    setTimeout(() => setHighlightedOrderId(undefined), 3000);
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o))
    );
  };

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Contacts sidebar */}
      <ContactsSidebar
        contacts={contacts}
        selectedId={selectedContactId}
        onSelect={setSelectedContactId}
      />

      {/* Chat area */}
      <ChatPanel
        contact={selectedContact}
        messages={currentMessages}
        onSendMessage={handleSendMessage}
        onOrderClick={handleOrderClick}
        highlightedOrderId={highlightedOrderId}
      />

      {/* Orders panel */}
      <OrdersPanel
        orders={orders}
        highlightedOrderId={highlightedOrderId}
        onStatusChange={handleStatusChange}
        cardRefs={cardRefs}
      />
    </main>
  );
}
