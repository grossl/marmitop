"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Minus, Plus, ShoppingCart, Trash2, UserPlus, UserRound } from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Badge } from "@mt/ui/components/badge";
import { Textarea } from "@mt/ui/components/textarea";
import { cn } from "@mt/ui/lib/utils";
import type { FormProduct, OrderFormData, PickerCustomer } from "@mt/http";
import { PAYMENT_LABELS, formatCents, parseMoneyToCents } from "@/components/orders-format";
import {
  createOrderAction,
  lookupCustomersAction,
  quickCreateCustomerAction,
} from "@/app/(app)/new-order/actions";

interface CartLine {
  key: string;
  menuItemId: string;
  sizeId: string | null;
  name: string;
  sizeName: string | null;
  unitPriceCents: number;
  qty: number;
  notes: string;
}

interface AddressForm {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  codigoMunicipio: string;
}

type Fulfillment = "delivery" | "pickup";
type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";
type Source = "counter" | "phone" | "whatsapp";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

/** FR-034: the customer's address, with the city fields defaulting to the restaurant's (ADR-016). */
function addressFor(customer: PickerCustomer | undefined, form: OrderFormData): AddressForm {
  return {
    cep: customer?.cep ?? "",
    logradouro: customer?.logradouro ?? "",
    numero: customer?.numero ?? "",
    complemento: customer?.complemento ?? "",
    bairro: customer?.bairro ?? "",
    cidade: customer?.cidade ?? form.cidade ?? "",
    uf: customer?.uf ?? form.uf ?? "",
    codigoMunicipio: customer?.codigoMunicipio ?? form.codigoMunicipio ?? "",
  };
}

export function ManualOrderPage({
  form,
  initialCustomers,
  initialCustomerId,
  conversationId,
}: {
  form: OrderFormData;
  initialCustomers: PickerCustomer[];
  initialCustomerId: string | null;
  conversationId: string | null;
}) {
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [customers, setCustomers] = useState<PickerCustomer[]>(initialCustomers);
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");
  const [address, setAddress] = useState<AddressForm>(() =>
    addressFor(initialCustomers.find((c) => c.id === initialCustomerId), form)
  );
  const [payment, setPayment] = useState<PaymentMethod>("pix");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>(conversationId ? "whatsapp" : "counter");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const customerData = customers.find((c) => c.id === customerId);

  // FR-030: search customers on the server as the user types.
  const lookupSeq = useRef(0);
  useEffect(() => {
    const term = customerQuery.trim();
    if (!term) return;
    const seq = ++lookupSeq.current;
    const t = setTimeout(() => {
      void lookupCustomersAction({ q: term, ids: customerId ? [customerId] : [] }).then((r) => {
        if (seq !== lookupSeq.current) return;
        if (r.ok) setCustomers(r.data);
        else toast.error(r.error.message);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [customerQuery, customerId]);

  function pickCustomer(id: string) {
    setCustomerId(id);
    setAddress(addressFor(customers.find((c) => c.id === id), form));
    setFieldErrors({});
  }

  async function createCustomer() {
    const result = await quickCreateCustomerAction({ name: newName, phone: newPhone });
    if (!result.ok) {
      toast.error(result.error.fieldErrors ? Object.values(result.error.fieldErrors).join(" ") : result.error.message);
      return;
    }
    setCustomers((all) => [result.data, ...all.filter((c) => c.id !== result.data.id)]);
    pickCustomer(result.data.id);
    setCreating(false);
    setNewName("");
    setNewPhone("");
    toast.success("Cliente criado.");
  }

  // FR-032: the server already filtered by availability and today's weekday; the search narrows it.
  const products = useMemo(
    () => form.products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [form.products, search]
  );

  function add(product: FormProduct, sizeId: string | null) {
    const size = product.sizes.find((s) => s.id === sizeId);
    const key = `${product.id}:${sizeId ?? ""}`;
    setCart((items) => {
      const existing = items.find((i) => i.key === key);
      if (existing) return items.map((i) => (i.key === key ? { ...i, qty: Math.min(99, i.qty + 1) } : i));
      return [
        ...items,
        {
          key,
          menuItemId: product.id,
          sizeId,
          name: product.name,
          sizeName: size?.name ?? product.volume,
          unitPriceCents: size?.priceCents ?? product.priceCents,
          qty: 1,
          notes: "",
        },
      ];
    });
  }

  const update = (key: string, patch: Partial<CartLine>) =>
    setCart((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Display only: the server recomputes every price and the total (ADR-006).
  const subtotal = cart.reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0);
  const fee = fulfillment === "delivery" ? form.deliveryFeeCents : 0;
  const total = subtotal + fee;

  const changeCents = payment === "dinheiro" && changeFor.trim() ? parseMoneyToCents(changeFor) : null;
  const changeInvalid = payment === "dinheiro" && changeFor.trim() !== "" && changeCents === null;
  const canSubmit = Boolean(customerId) && cart.length > 0 && !changeInvalid && !submitting;

  function submit() {
    setFieldErrors({});
    startSubmit(async () => {
      const result = await createOrderAction({
        customerId,
        items: cart.map((i) => ({
          menuItemId: i.menuItemId,
          sizeId: i.sizeId,
          qty: i.qty,
          notes: i.notes,
        })),
        fulfillment,
        ...(fulfillment === "delivery" ? address : {}),
        paymentMethod: payment,
        changeForCents: changeCents,
        notes,
        source,
        conversationId: conversationId ?? undefined,
      });
      if (!result.ok) {
        const details = result.error.fieldErrors;
        if (details) setFieldErrors(details);
        toast.error(details ? Object.values(details).join(" ") : result.error.message);
        return;
      }
      toast.success(`Pedido ${result.data.code} criado.`);
      // Back to the board with the new card highlighted.
      router.push(`/orders?new=${result.data.id}`);
    });
  }

  const field = (name: keyof AddressForm, label: string, className?: string) => (
    <label className={cn("block text-xs", className)}>
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Input
        value={address[name]}
        onChange={(e) => setAddress((a) => ({ ...a, [name]: e.target.value }))}
        aria-invalid={Boolean(fieldErrors[name])}
      />
      {fieldErrors[name] && <span className="mt-1 block text-destructive">{fieldErrors[name]}</span>}
    </label>
  );

  return (
    <section className="h-full overflow-auto bg-background p-6 lg:p-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Atendimento</p>
        <h1 className="mt-1 text-2xl font-bold">Novo pedido</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monte e processe pedidos recebidos no balcão ou por telefone.
        </p>
      </header>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Produtos</h2>
              <p className="text-xs text-muted-foreground">Selecione marmitas e bebidas disponíveis hoje</p>
            </div>
          </div>
          <Input
            placeholder="Buscar produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-4"
          />
          {products.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum produto disponível hoje.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map((product) => (
              <div
                key={product.id}
                className="flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div>
                  <Badge variant="secondary" className="mb-1 text-[10px]">
                    {product.kind === "meal" ? "Marmita" : "Bebida"}
                  </Badge>
                  <p className="text-sm font-semibold">{product.name}</p>
                  {product.volume && <p className="text-xs text-muted-foreground">{product.volume}</p>}
                </div>
                {product.sizes.length === 0 ? (
                  <button
                    onClick={() => add(product, null)}
                    className="flex items-center justify-end gap-1 text-sm font-bold text-primary"
                  >
                    <Plus className="h-4 w-4" /> {formatCents(product.priceCents)}
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((size) => (
                      <button
                        key={size.id}
                        onClick={() => add(product, size.id)}
                        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold text-primary hover:bg-primary/10"
                      >
                        <Plus className="h-3 w-3" /> {size.name} · {formatCents(size.priceCents)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-xl border bg-card p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Resumo do pedido</h2>
              <p className="text-xs text-muted-foreground">Escolha o cliente e confirme</p>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm font-medium">Cliente</label>
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-primary"
            >
              <UserPlus className="h-3.5 w-3.5" /> {creating ? "Cancelar" : "Novo cliente"}
            </button>
          </div>
          {creating ? (
            <div className="mb-5 space-y-2 rounded-lg bg-muted/50 p-3">
              <Input placeholder="Nome" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Telefone (com DDD)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!newName.trim() || !newPhone.trim()}
                onClick={() => void createCustomer()}
              >
                Criar cliente
              </Button>
            </div>
          ) : (
            <>
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="mb-2"
              />
              <select
                value={customerId}
                onChange={(e) => pickCustomer(e.target.value)}
                className={cn(selectClass, "mb-5")}
              >
                <option value="">Selecione um cliente</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.phone}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2">
            {(["delivery", "pickup"] as const).map((f) => (
              <button
                key={f}
                type="button"
                disabled={f === "pickup" && !form.allowPickup}
                onClick={() => setFulfillment(f)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40",
                  fulfillment === f ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                {f === "delivery" ? "Entrega" : "Retirada"}
              </button>
            ))}
          </div>

          {fulfillment === "delivery" && customerId && (
            <div className="mb-4 grid grid-cols-6 gap-2 rounded-lg bg-muted/50 p-3">
              {field("logradouro", "Rua", "col-span-4")}
              {field("numero", "Número", "col-span-2")}
              {field("complemento", "Complemento", "col-span-3")}
              {field("bairro", "Bairro", "col-span-3")}
              {field("cidade", "Cidade", "col-span-3")}
              {field("uf", "UF", "col-span-1")}
              {field("cep", "CEP", "col-span-2")}
            </div>
          )}
          {fulfillment === "delivery" && !customerId && customerData === undefined && (
            <p className="mb-4 text-xs text-muted-foreground">Escolha o cliente para preencher o endereço.</p>
          )}

          <div className="space-y-3 border-y py-4">
            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum item adicionado</p>
            ) : (
              cart.map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sizeName ?? ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => update(item.key, { qty: Math.max(1, item.qty - 1) })}
                        className="rounded border p-0.5"
                        aria-label={`Diminuir ${item.name}`}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-sm">{item.qty}</span>
                      <button
                        onClick={() => update(item.key, { qty: Math.min(99, item.qty + 1) })}
                        className="rounded border p-0.5"
                        aria-label={`Aumentar ${item.name}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <span className="w-20 text-right text-sm font-semibold">
                        {formatCents(item.unitPriceCents * item.qty)}
                      </span>
                      <button
                        onClick={() => setCart((all) => all.filter((entry) => entry.key !== item.key))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remover ${item.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <Input
                    placeholder="Observação do item"
                    value={item.notes}
                    maxLength={280}
                    onChange={(e) => update(item.key, { notes: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 border-b py-4">
            <label className="block text-sm font-medium">Pagamento</label>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value as PaymentMethod)}
              className={selectClass}
            >
              {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {payment === "dinheiro" && (
              <div>
                <Input
                  placeholder="Troco para quanto? (opcional)"
                  value={changeFor}
                  onChange={(e) => setChangeFor(e.target.value)}
                  aria-invalid={changeInvalid || Boolean(fieldErrors.changeForCents)}
                />
                {(changeInvalid || fieldErrors.changeForCents) && (
                  <span className="mt-1 block text-xs text-destructive">
                    {fieldErrors.changeForCents ?? "Informe um valor, por exemplo 50,00."}
                  </span>
                )}
              </div>
            )}
            <label className="block text-sm font-medium">Origem</label>
            <select value={source} onChange={(e) => setSource(e.target.value as Source)} className={selectClass}>
              <option value="counter">Balcão</option>
              <option value="phone">Telefone</option>
              {conversationId && <option value="whatsapp">WhatsApp</option>}
            </select>
            <Textarea
              placeholder="Observação do pedido"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <dl className="space-y-1 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatCents(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Entrega</dt>
              <dd>{formatCents(fee)}</dd>
            </div>
            <div className="flex items-center justify-between pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="text-xl font-bold text-primary">{formatCents(total)}</dd>
            </div>
          </dl>
          <Button disabled={!canSubmit} className="w-full gap-2" onClick={submit}>
            <Check className="h-4 w-4" /> Criar pedido
          </Button>
        </aside>
      </div>
    </section>
  );
}

export default ManualOrderPage;
