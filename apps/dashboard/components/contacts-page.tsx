"use client";

import { useState, useMemo } from "react";
import { Users, Search, MapPin, Phone, Mail, ShoppingBag, TrendingUp, Calendar } from "lucide-react";
import { Input } from "@mt/ui/components/input";
import { Badge } from "@mt/ui/components/badge";
import { Separator } from "@mt/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@mt/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mt/ui/components/table";
import { cn } from "@mt/ui/lib/utils";
import {
  contacts as allContacts,
  orders as allOrders,
  statusLabels,
  paymentLabels,
  type Contact,
  type OrderStatus,
} from "@/lib/marmita-data";

// ─── Status style map ─────────────────────────────────────────────────────────

const statusStyles: Record<OrderStatus, string> = {
  aguardando: "bg-yellow-100 text-yellow-700 border-yellow-200",
  confirmado:  "bg-blue-100 text-blue-700 border-blue-200",
  preparando:  "bg-amber-100 text-amber-700 border-amber-200",
  pronto:      "bg-green-100 text-green-700 border-green-200",
  saiu:        "bg-purple-100 text-purple-700 border-purple-200",
  entregue:    "bg-slate-100 text-slate-600 border-slate-200",
};

// ─── Contact detail sheet ─────────────────────────────────────────────────────

function ContactSheet({
  contact,
  open,
  onClose,
}: {
  contact: Contact | null;
  open: boolean;
  onClose: () => void;
}) {
  const contactOrders = useMemo(
    () => (contact ? allOrders.filter((o) => o.contactId === contact.id) : []),
    [contact]
  );

  if (!contact) return null;

  const totalSpent = contactOrders
    .reduce((s, o) => s + o.total, 0);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border">
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/15 text-primary text-xl font-bold shrink-0">
              {contact.avatar}
            </div>
            <div>
              <SheetTitle className="text-lg">{contact.name}</SheetTitle>
              <SheetDescription className="text-sm">{contact.neighborhood}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Info */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Phone className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {contact.phone}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Mail className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {contact.email}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <MapPin className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {contact.address}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            Cliente desde {new Date(contact.joinDate + "T00:00:00").toLocaleDateString("pt-BR")}
          </div>
        </div>

        <Separator />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total de pedidos</p>
            <p className="text-2xl font-bold text-foreground">{contact.totalOrders}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total gasto</p>
            <p className="text-2xl font-bold text-primary">
              R$ {totalSpent.toFixed(2).replace(".", ",")}
            </p>
          </div>
        </div>

        <Separator />

        {/* Order history */}
        <div className="flex-1 overflow-y-auto">
          <p className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Histórico de pedidos
          </p>
          {contactOrders.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum pedido registrado.</p>
          ) : (
            <div className="px-5 pb-5 space-y-3">
              {contactOrders.map((order) => (
                <div
                  key={order.id}
                  className="border border-border rounded-lg p-3 space-y-2 bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium text-primary">{order.id}</span>
                    <Badge
                      variant="outline"
                      className={cn("text-xs border", statusStyles[order.status])}
                    >
                      {statusLabels[order.status]}
                    </Badge>
                  </div>
                  <ul className="space-y-0.5">
                    {order.items.map((item, i) => (
                      <li key={i} className="text-sm text-foreground">
                        {item.qty}x {item.name}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(order.date + "T00:00:00").toLocaleDateString("pt-BR")} — {order.createdAt}</span>
                    <span className="font-semibold text-foreground">
                      R$ {order.total.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{paymentLabels[order.payment]}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ContactsPage() {
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return allContacts.filter(
      (c) =>
        !term ||
        c.name.toLowerCase().includes(term) ||
        c.phone.includes(term) ||
        c.neighborhood.toLowerCase().includes(term)
    );
  }, [search]);

  const handleRowClick = (contact: Contact) => {
    setSelectedContact(contact);
    setSheetOpen(true);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <Users className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Contatos</h1>
        <Badge variant="secondary" className="ml-auto">
          {allContacts.length} clientes
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nome, telefone ou bairro..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold text-foreground">Cliente</TableHead>
                <TableHead className="font-semibold text-foreground hidden sm:table-cell">Telefone</TableHead>
                <TableHead className="font-semibold text-foreground hidden md:table-cell">Bairro</TableHead>
                <TableHead className="font-semibold text-foreground hidden lg:table-cell">Cliente desde</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Pedidos</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Total gasto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    Nenhum contato encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(contact)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                          {contact.avatar}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{contact.phone}</p>
                        </div>
                        {contact.online && (
                          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-label="Online" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {contact.phone}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {contact.neighborhood}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {new Date(contact.joinDate + "T00:00:00").toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium text-foreground">{contact.totalOrders}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary text-sm whitespace-nowrap">
                      R$ {contact.totalSpent.toFixed(2).replace(".", ",")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Clique em um contato para ver o histórico completo de pedidos.
        </p>
      </div>

      <ContactSheet
        contact={selectedContact}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
