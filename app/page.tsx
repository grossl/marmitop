"use client";

import { useRef, useState } from "react";
import { ContactsSidebar } from "@/components/contacts-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { OrdersPanel } from "@/components/orders-panel";
import { NavSidebar } from "@/components/nav-sidebar";
import { OrdersPage } from "@/components/orders-page";
import { ContactsPage } from "@/components/contacts-page";
import { ReportsPage } from "@/components/reports-page";
import {
  contacts,
  messages as initialMessages,
  orders as initialOrders,
  type Message,
  type Order,
  type OrderStatus,
  type Section,
} from "@/lib/marmita-data";

export default function MarmitaChatPage() {
  const [section, setSection] = useState<Section>("mensagens");

  // Chat / orders state
  const [selectedContactId, setSelectedContactId] = useState("1");
  const [messages, setMessages] = useState(initialMessages);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | undefined>();

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const selectedContact = contacts.find((c) => c.id === selectedContactId)!;
  const currentMessages = messages[selectedContactId] ?? [];

  // Derived badge counts
  const unreadCount = contacts.reduce((s, c) => s + c.unread, 0);
  const newOrdersCount = orders.filter((o) => o.status === "novo").length;

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
    setTimeout(() => {
      const el = cardRefs.current[orderId];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlightedOrderId(undefined), 3000);
  };

  const handleStatusChange = (id: string, status: OrderStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
  };

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Primary nav */}
      <NavSidebar
        active={section}
        onSelect={setSection}
        unreadCount={unreadCount}
        newOrdersCount={newOrdersCount}
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
            onOrderClick={handleOrderClick}
            highlightedOrderId={highlightedOrderId}
          />
          <OrdersPanel
            orders={orders}
            highlightedOrderId={highlightedOrderId}
            onStatusChange={handleStatusChange}
            cardRefs={cardRefs}
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

      {section === "relatorios" && (
        <div className="flex-1 overflow-hidden">
          <ReportsPage />
        </div>
      )}
    </main>
  );
}
