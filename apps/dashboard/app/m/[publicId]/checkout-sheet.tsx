"use client";

import type { PublicMenuDto } from "@mt/http";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Label } from "@mt/ui/components/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@mt/ui/components/sheet";
import { Textarea } from "@mt/ui/components/textarea";
import { cn } from "@mt/ui/lib/utils";
import { Bike, CheckCircle2, ChevronDown, Loader2, MessageCircle, Store, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { formatBRL, reaisToCents } from "@/app/(app)/menu/menu-helpers";

import { placePublicOrderAction } from "./actions";
import { cartTotals, type PricedLine } from "./cart";
import { whatsappLink } from "./public-menu-helpers";
import { Stepper } from "./stepper";

// Checkout for the public menu (ADR-031, FR-231). Responsive (FR-237): full screen on a
// phone, a bottom sheet on a tablet, a side panel on a desktop. One column, 16 px inputs
// with phone keyboards and autofill, and the send button fixed at the bottom.

type Fulfillment = "delivery" | "pickup";
type Payment = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";

const PAYMENTS: readonly { value: Payment; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
];

interface CustomerForm {
  name: string;
  phone: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
}

const EMPTY_CUSTOMER: CustomerForm = { name: "", phone: "", logradouro: "", numero: "", complemento: "", bairro: "" };
// The customer's own details, kept on their device for the next order.
const CUSTOMER_KEY = "mt.public-menu.customer";

function loadCustomer(): CustomerForm {
  try {
    const raw = window.localStorage.getItem(CUSTOMER_KEY);
    if (raw === null) return EMPTY_CUSTOMER;
    const saved = JSON.parse(raw) as Partial<Record<keyof CustomerForm, unknown>>;
    const pick = (k: keyof CustomerForm) => (typeof saved[k] === "string" ? (saved[k] as string) : "");
    return {
      name: pick("name"),
      phone: pick("phone"),
      logradouro: pick("logradouro"),
      numero: pick("numero"),
      complemento: pick("complemento"),
      bairro: pick("bairro"),
    };
  } catch {
    return EMPTY_CUSTOMER;
  }
}

function saveCustomer(form: CustomerForm): void {
  try {
    window.localStorage.setItem(CUSTOMER_KEY, JSON.stringify(form));
  } catch {
    // Not saved; the next order asks again.
  }
}

/** The `lg` breakpoint: from here the checkout is a side panel, below it a bottom sheet. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

interface Placed {
  readonly code: string;
  readonly totalCents: number;
}

export function CheckoutSheet({
  open,
  onOpenChange,
  publicId,
  menu,
  lines,
  onChangeQty,
  onPlaced,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicId: string;
  menu: PublicMenuDto;
  lines: readonly PricedLine[];
  onChangeQty: (menuItemId: string, sizeId: string | null, qty: number) => void;
  onPlaced: () => void;
}) {
  const [customer, setCustomer] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");
  const [payment, setPayment] = useState<Payment>("pix");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [pending, startTransition] = useTransition();
  const desktop = useMediaQuery(DESKTOP_QUERY);

  useEffect(() => setCustomer(loadCustomer()), []);
  // A closed sheet forgets the last result, so the next cart starts a new checkout.
  useEffect(() => {
    if (!open) setPlaced(null);
  }, [open]);

  const totals = cartTotals(lines, fulfillment, menu.deliveryFeeCents);
  const delivery = fulfillment === "delivery";
  const patch = (p: Partial<CustomerForm>) => setCustomer((c) => ({ ...c, ...p }));

  const submit = () => {
    setFieldErrors({});
    setFormError(null);
    let changeForCents: number | null = null;
    if (payment === "dinheiro" && changeFor.trim() !== "") {
      changeForCents = reaisToCents(changeFor);
      if (changeForCents === null) {
        setFieldErrors({ changeForCents: "Valor inválido. Exemplo: 50,00" });
        return;
      }
    }
    startTransition(async () => {
      const result = await placePublicOrderAction(publicId, {
        name: customer.name,
        phone: customer.phone,
        items: lines.map((l) => ({ menuItemId: l.menuItemId, sizeId: l.sizeId, qty: l.qty })),
        fulfillment,
        logradouro: delivery ? orNull(customer.logradouro) : null,
        numero: delivery ? orNull(customer.numero) : null,
        complemento: delivery ? orNull(customer.complemento) : null,
        bairro: delivery ? orNull(customer.bairro) : null,
        paymentMethod: payment,
        changeForCents,
        notes: orNull(notes),
      });
      if (result.ok) {
        saveCustomer(customer);
        setPlaced(result.data);
        setNotes("");
        setChangeFor("");
        onPlaced();
        return;
      }
      const errors = result.error.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(
        errors[""] ?? (Object.keys(errors).length > 0 ? "Confira os campos destacados." : result.error.message),
      );
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "gap-0 p-0 [&>button:last-child]:hidden",
          desktop
            ? "w-full sm:max-w-md"
            : "mx-auto h-[100dvh] max-w-2xl rounded-none sm:h-[92dvh] sm:rounded-t-2xl sm:border-x",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="min-w-0">
            <SheetTitle className="text-base">{placed ? "Pedido enviado" : "Seu pedido"}</SheetTitle>
            <SheetDescription className="truncate text-xs">{menu.restaurantName}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fechar">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
        </div>

        {placed ? (
          <PlacedView placed={placed} phone={menu.phone} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Itens</h3>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Seu carrinho está vazio.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {lines.map((l) => (
                      <li key={`${l.menuItemId}:${l.sizeId ?? ""}`} className="flex items-center gap-3 py-2 pr-2 pl-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {l.name}
                            {l.sizeName !== null && <span className="text-muted-foreground"> · {l.sizeName}</span>}
                          </p>
                          <p className="text-sm text-muted-foreground">{formatBRL(l.lineCents)}</p>
                        </div>
                        <Stepper
                          label={l.sizeName === null ? l.name : `${l.name} ${l.sizeName}`}
                          qty={l.qty}
                          onChange={(qty) => onChangeQty(l.menuItemId, l.sizeId, qty)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Seus dados</h3>
                <Field id="co-name" label="Nome" error={fieldErrors.name}>
                  <Input
                    id="co-name"
                    autoComplete="name"
                    enterKeyHint="next"
                    value={customer.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    className="h-12 text-base"
                  />
                </Field>
                <Field id="co-phone" label="Telefone (WhatsApp)" error={fieldErrors.phone}>
                  <Input
                    id="co-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    placeholder="(11) 99999-0000"
                    value={customer.phone}
                    onChange={(e) => patch({ phone: e.target.value })}
                    className="h-12 text-base"
                  />
                </Field>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Entrega</h3>
                <div className={cn("grid gap-2", menu.allowPickup ? "grid-cols-2" : "grid-cols-1")}>
                  <Choice selected={delivery} onSelect={() => setFulfillment("delivery")}>
                    <Bike className="h-4 w-4" /> Entrega
                  </Choice>
                  {menu.allowPickup && (
                    <Choice selected={!delivery} onSelect={() => setFulfillment("pickup")}>
                      <Store className="h-4 w-4" /> Retirar
                    </Choice>
                  )}
                </div>
                {delivery && (
                  <div className="space-y-3">
                    <Field id="co-street" label="Rua" error={fieldErrors.logradouro}>
                      <Input
                        id="co-street"
                        autoComplete="address-line1"
                        enterKeyHint="next"
                        value={customer.logradouro}
                        onChange={(e) => patch({ logradouro: e.target.value })}
                        className="h-12 text-base"
                      />
                    </Field>
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
                      <Field id="co-number" label="Número" error={fieldErrors.numero}>
                        <Input
                          id="co-number"
                          inputMode="numeric"
                          enterKeyHint="next"
                          value={customer.numero}
                          onChange={(e) => patch({ numero: e.target.value })}
                          className="h-12 text-base"
                        />
                      </Field>
                      <Field id="co-complement" label="Complemento" error={fieldErrors.complemento}>
                        <Input
                          id="co-complement"
                          autoComplete="address-line2"
                          enterKeyHint="next"
                          placeholder="Apto, bloco"
                          value={customer.complemento}
                          onChange={(e) => patch({ complemento: e.target.value })}
                          className="h-12 text-base"
                        />
                      </Field>
                    </div>
                    <Field id="co-district" label="Bairro" error={fieldErrors.bairro}>
                      <Input
                        id="co-district"
                        autoComplete="address-level3"
                        enterKeyHint="done"
                        value={customer.bairro}
                        onChange={(e) => patch({ bairro: e.target.value })}
                        className="h-12 text-base"
                      />
                    </Field>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Pagamento na entrega</h3>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENTS.map((p) => (
                    <Choice key={p.value} selected={payment === p.value} onSelect={() => setPayment(p.value)}>
                      {p.label}
                    </Choice>
                  ))}
                </div>
                {payment === "dinheiro" && (
                  <Field id="co-change" label="Troco para (opcional)" error={fieldErrors.changeForCents}>
                    <Input
                      id="co-change"
                      inputMode="decimal"
                      placeholder="50,00"
                      value={changeFor}
                      onChange={(e) => setChangeFor(e.target.value)}
                      className="h-12 text-base"
                    />
                  </Field>
                )}
              </section>

              <section className="space-y-2">
                <NotesField value={notes} onChange={setNotes} error={fieldErrors.notes} />
              </section>

              <section className="space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm">
                <Row label="Subtotal" value={formatBRL(totals.subtotalCents)} />
                {delivery && <Row label="Taxa de entrega" value={formatBRL(totals.deliveryFeeCents)} />}
                <Row label="Total" value={formatBRL(totals.totalCents)} strong />
              </section>
            </div>

            <div className="border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {formError !== null && (
                <p role="alert" className="mb-2 text-sm font-medium text-destructive">
                  {formError}
                </p>
              )}
              <Button
                className="h-13 w-full justify-between rounded-xl px-4 text-base"
                disabled={pending || lines.length === 0}
                onClick={submit}
              >
                <span className="flex items-center gap-2">
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {pending ? "Enviando..." : "Enviar pedido"}
                </span>
                <span className="font-bold">{formatBRL(totals.totalCents)}</span>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PlacedView({ placed, phone, onClose }: { placed: Placed; phone: string | null; onClose: () => void }) {
  const whatsapp = whatsappLink(phone);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-10 text-center">
      <CheckCircle2 className="h-14 w-14 text-primary" />
      <div className="space-y-1">
        <p className="text-xl font-bold text-foreground">Pedido {placed.code} enviado!</p>
        <p className="text-sm text-muted-foreground">Aguardando confirmação do restaurante.</p>
      </div>
      <p className="text-base">
        Total: <span className="font-bold">{formatBRL(placed.totalCents)}</span>
      </p>
      <div className="flex w-full max-w-xs flex-col gap-2 pt-2">
        {whatsapp !== null && (
          <Button asChild variant="outline" className="h-12 gap-2">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> Falar com o restaurante
            </a>
          </Button>
        )}
        <Button className="h-12" onClick={onClose}>
          Voltar ao cardápio
        </Button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", error !== undefined && "[&_input]:border-destructive")}>
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {error !== undefined && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function NotesField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
}) {
  const [open, setOpen] = useState(value !== "");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary"
      >
        <ChevronDown className="h-4 w-4" /> Adicionar observação
      </button>
    );
  }
  return (
    <Field id="co-notes" label="Observação" error={error}>
      <Textarea
        id="co-notes"
        rows={3}
        maxLength={1000}
        placeholder="Ex.: sem cebola, troco, ponto de referência"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-base"
      />
    </Field>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex justify-between",
        strong ? "pt-1 text-base font-bold text-foreground" : "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
