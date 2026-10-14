"use client";

import type { CustomerDto, CustomerOrderSummary } from "@mt/http";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, Search, MapPin, Phone, Mail, ShoppingBag, Calendar, Plus, Pencil, IdCard } from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Label } from "@mt/ui/components/label";
import { Textarea } from "@mt/ui/components/textarea";
import { Badge } from "@mt/ui/components/badge";
import { Separator } from "@mt/ui/components/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@mt/ui/components/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@mt/ui/components/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mt/ui/components/table";
import { cn } from "@mt/ui/lib/utils";

import { createCustomerAction, updateCustomerAction } from "@/app/(app)/contacts/actions";
import {
  addressLine,
  formatBRL,
  formatDate,
  initials,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_LABELS,
} from "@/components/messaging-format";

// ─── Customer form (create and edit; FR-045, FR-046, ADR-016) ────────────────

const FIELDS = [
  "name",
  "phone",
  "email",
  "cpfCnpj",
  "cep",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "codigoMunicipio",
  "notes",
] as const;
type Field = (typeof FIELDS)[number];
type FormState = Record<Field, string>;

function formFrom(customer: CustomerDto | null): FormState {
  const form = {} as FormState;
  for (const f of FIELDS) form[f] = customer?.[f] ?? "";
  return form;
}

function CustomerFormDialog({
  customer,
  open,
  onClose,
  onSaved,
}: {
  customer: CustomerDto | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFrom(customer));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) {
      setForm(formFrom(customer));
      setErrors({});
    }
  }, [open, customer]);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = () =>
    start(async () => {
      const result = customer
        ? await updateCustomerAction({ customerId: customer.id, ...form })
        : await createCustomerAction(form);
      if (!result.ok) {
        setErrors(result.error.fieldErrors ?? {});
        toast.error(result.error.message);
        return;
      }
      toast.success(customer ? "Cliente atualizado." : "Cliente criado.");
      onSaved();
      onClose();
    });

  const field = (id: Field, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`customer-${id}`}>{label}</Label>
      <Input id={`customer-${id}`} value={form[id]} onChange={set(id)} aria-invalid={!!errors[id]} {...props} />
      {errors[id] && <p className="text-xs text-destructive">{errors[id]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{customer ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("name", "Nome", { maxLength: 120 })}</div>
          {field("phone", "Telefone", { placeholder: "(11) 98888-7777", inputMode: "tel" })}
          {field("email", "E-mail", { type: "email" })}
          <div className="sm:col-span-2">{field("cpfCnpj", "CPF ou CNPJ", { inputMode: "numeric" })}</div>
          {field("cep", "CEP", { placeholder: "00000-000", inputMode: "numeric" })}
          {field("bairro", "Bairro")}
          <div className="sm:col-span-2">{field("logradouro", "Rua")}</div>
          {field("numero", "Número")}
          {field("complemento", "Complemento")}
          {field("cidade", "Cidade")}
          <div className="grid grid-cols-2 gap-4">
            {field("uf", "UF", { maxLength: 2 })}
            {field("codigoMunicipio", "Cód. município (IBGE)", { inputMode: "numeric", maxLength: 7 })}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="customer-notes">Observações</Label>
            <Textarea id="customer-notes" value={form.notes} onChange={set("notes")} maxLength={1000} rows={3} />
            {errors.notes && <p className="text-xs text-destructive">{errors.notes}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !form.name.trim() || !form.phone.trim()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Contact detail sheet (FR-042, FR-043, FR-044) ───────────────────────────

function ContactSheet({
  contact,
  orders,
  onClose,
  onEdit,
}: {
  contact: CustomerDto;
  orders: readonly CustomerOrderSummary[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const address = addressLine(contact);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/15 text-primary text-xl font-bold shrink-0">
              {initials(contact.name)}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg">{contact.name}</SheetTitle>
              <SheetDescription className="text-sm">{contact.bairro ?? ""}</SheetDescription>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </SheetHeader>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Phone className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {contact.phone}
          </div>
          {contact.email && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Mail className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              {contact.email}
            </div>
          )}
          {contact.cpfCnpj && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <IdCard className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              {contact.cpfCnpj}
            </div>
          )}
          {address && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              {address}
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            Cliente desde {formatDate(contact.createdAt)}
          </div>
          {contact.notes && <p className="text-sm text-muted-foreground">{contact.notes}</p>}
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total de pedidos</p>
            <p className="text-2xl font-bold text-foreground">{contact.ordersCount}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Total gasto</p>
            <p className="text-2xl font-bold text-primary">{formatBRL(contact.totalSpentCents)}</p>
          </div>
        </div>

        <Separator />

        <div className="flex-1 overflow-y-auto">
          <p className="px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Histórico de pedidos
          </p>
          {orders.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum pedido registrado.</p>
          ) : (
            <div className="px-5 pb-5 space-y-3">
              {orders.map((order) => (
                <div key={order.id} className="border border-border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium text-primary">{order.code}</span>
                    <Badge variant="outline" className={cn("text-xs border", ORDER_STATUS_STYLES[order.status])}>
                      {ORDER_STATUS_LABELS[order.status] ?? order.status}
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
                    <span>{formatDate(order.createdAt)}</span>
                    <span className="font-semibold text-foreground">{formatBRL(order.totalCents)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface ContactsPageProps {
  query: string;
  customers: CustomerDto[];
  hasMore: boolean;
  selected: { customer: CustomerDto; orders: CustomerOrderSummary[] } | null;
}

export function ContactsPage({ query, customers, hasMore, selected }: ContactsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(query);
  const [formOpen, setFormOpen] = useState<"create" | "edit" | null>(null);
  const first = useRef(true);

  const urlFor = (q: string, id?: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (id) params.set("id", id);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Server-side search (FR-041), debounced; the route reloads with ?q=.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => router.replace(urlFor(search)), 300);
    return () => clearTimeout(t);
    // biome-ignore lint/correctness/useExhaustiveDependencies: only the term should retrigger
  }, [search]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <Users className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Contatos</h1>
        <Badge variant="secondary" className="ml-auto">
          {customers.length}
          {hasMore ? "+" : ""} clientes
        </Badge>
        <Button size="sm" className="gap-1.5" onClick={() => setFormOpen("create")}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nome, telefone ou bairro..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

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
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    Nenhum contato encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => router.push(urlFor(search, contact.id), { scroll: false })}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                          {initials(contact.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                          <p className="text-xs text-muted-foreground sm:hidden">{contact.phone}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{contact.phone}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {contact.bairro ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {formatDate(contact.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-medium text-foreground">{contact.ordersCount}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary text-sm whitespace-nowrap">
                      {formatBRL(contact.totalSpentCents)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          {hasMore ? "Mostrando os 100 primeiros. Use a busca para achar outros. " : ""}
          Clique em um contato para ver o histórico completo de pedidos.
        </p>
      </div>

      {selected && (
        <ContactSheet
          contact={selected.customer}
          orders={selected.orders}
          onClose={() => router.replace(urlFor(search), { scroll: false })}
          onEdit={() => setFormOpen("edit")}
        />
      )}

      <CustomerFormDialog
        customer={formOpen === "edit" ? (selected?.customer ?? null) : null}
        open={formOpen !== null}
        onClose={() => setFormOpen(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
