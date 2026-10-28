"use client";

import type { PublicMenuDto, PublicMenuItemDto } from "@mt/http";
import { Badge } from "@mt/ui/components/badge";
import { Button } from "@mt/ui/components/button";
import { cn } from "@mt/ui/lib/utils";
import { ChefHat, Clock, GlassWater, MessageCircle, ShoppingBag, Star, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatBRL } from "@/app/(app)/menu/menu-helpers";

import { type Cart, cartTotals, type PricedLine, parseCart, priceCart, qtyOf, setQty } from "./cart";
import { CheckoutSheet } from "./checkout-sheet";
import {
  groupByCategory,
  isOfferedOn,
  type PublicMenuSection,
  startingPriceCents,
  weekdaysText,
  whatsappLink,
} from "./public-menu-helpers";
import { Stepper } from "./stepper";

// The public menu with cart (ADR-030, ADR-031). Responsive (FR-237):
//   * phone (< 640 px): one column, the cart bar fixed at the bottom, checkout full screen;
//   * tablet (640–1023 px): items in two columns, the same cart bar, checkout as a bottom sheet;
//   * desktop (>= 1024 px): items in two columns beside a sticky cart panel, checkout as a side panel.
// Tap targets are at least 44 px high at every size.

const cartKey = (publicId: string) => `mt.public-menu.cart.${publicId}`;

export function PublicMenuClient({ publicId, menu, today }: { publicId: string; menu: PublicMenuDto; today: number }) {
  const [cart, setCart] = useState<Cart>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // The cart survives a reload on the customer's device. Storage can be missing or blocked.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(cartKey(publicId));
      if (saved !== null) setCart(parseCart(JSON.parse(saved)));
    } catch {
      // Start with an empty cart.
    }
  }, [publicId]);
  useEffect(() => {
    try {
      window.localStorage.setItem(cartKey(publicId), JSON.stringify(cart));
    } catch {
      // Not saved; the cart still works for this visit.
    }
  }, [publicId, cart]);

  const lines = useMemo(() => priceCart(cart, menu.items, today), [cart, menu.items, today]);
  const preview = cartTotals(lines, "delivery", 0);
  const meals = groupByCategory(menu.items, "meal");
  const drinks = groupByCategory(menu.items, "drink");
  const sections = [...meals, ...drinks];
  const whatsapp = whatsappLink(menu.phone);
  const open = menu.openNow;
  // ADR-033: the order goes out by WhatsApp, so a restaurant without a phone takes no menu orders.
  const canOrder = open && whatsapp !== null;
  const blockedLabel = open ? "Pedidos indisponíveis" : "Fechado agora";

  const change = (item: PublicMenuItemDto, sizeId: string | null, qty: number) =>
    setCart((c) => setQty(c, item.id, sizeId, qty));
  const changeLine = (menuItemId: string, sizeId: string | null, qty: number) =>
    setCart((c) => setQty(c, menuItemId, sizeId, qty));

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:h-12 sm:w-12">
              <ChefHat className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-foreground sm:text-xl">{menu.restaurantName}</h1>
              <p className={cn("text-xs font-medium sm:text-sm", open ? "text-primary" : "text-muted-foreground")}>
                {open ? "Aberto agora" : "Fechado agora"}
              </p>
            </div>
          </div>
          {whatsapp !== null && (
            <Button asChild variant="outline" className="h-11 shrink-0 gap-2">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            </Button>
          )}
        </div>
        {sections.length > 1 && (
          <nav aria-label="Categorias" className="mx-auto max-w-6xl px-4 pb-2 sm:px-6 lg:px-8">
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sections.map((section) => (
                <li key={`${section.items[0]?.kind}-${section.category}`} className="shrink-0">
                  <a
                    href={`#cat-${section.items[0]?.kind}-${section.category}`}
                    className="flex h-9 items-center rounded-full border border-border bg-background px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className={cn("min-w-0 space-y-8 pt-5 sm:pt-6", preview.count > 0 ? "pb-32 lg:pb-12" : "pb-12")}>
          {!open && (
            <p className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              Estamos fechados agora. Você pode ver o cardápio, mas os pedidos abrem no horário de funcionamento.
            </p>
          )}
          {open && whatsapp === null && (
            <p className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              <MessageCircle className="h-4 w-4 shrink-0" />
              Este restaurante ainda não recebe pedidos pelo cardápio online.
            </p>
          )}
          {menu.items.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              O cardápio ainda não tem itens disponíveis.
            </p>
          ) : (
            <>
              <MenuGroup
                title="Marmitas"
                icon={UtensilsCrossed}
                sections={meals}
                today={today}
                cart={cart}
                canOrder={canOrder}
                onChange={change}
              />
              <MenuGroup
                title="Bebidas"
                icon={GlassWater}
                sections={drinks}
                today={today}
                cart={cart}
                canOrder={canOrder}
                onChange={change}
              />
            </>
          )}
          <p className="pt-2 text-center text-xs text-muted-foreground">Preços sujeitos a alteração.</p>
        </main>

        {/* Desktop: the cart stays beside the menu. */}
        <aside className="hidden lg:block">
          <div className="sticky top-32 mt-6 max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-xl border border-border bg-card p-4">
            <CartPanel
              blockedLabel={blockedLabel}
              lines={lines}
              subtotalCents={preview.subtotalCents}
              canOrder={canOrder}
              onChangeQty={changeLine}
              onCheckout={() => setCheckoutOpen(true)}
            />
          </div>
        </aside>
      </div>

      {/* Phone and tablet: the cart bar stays at the bottom of the screen. */}
      {preview.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 lg:hidden">
          <div className="mx-auto max-w-2xl">
            <Button
              className="h-13 w-full justify-between gap-3 rounded-xl px-4 text-base"
              disabled={!canOrder}
              onClick={() => setCheckoutOpen(true)}
            >
              <span className="flex items-center gap-2">
                <span className="relative">
                  <ShoppingBag className="h-5 w-5" />
                  <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-[11px] font-bold text-primary">
                    {preview.count}
                  </span>
                </span>
                {canOrder ? "Ver carrinho" : blockedLabel}
              </span>
              <span className="font-bold">{formatBRL(preview.subtotalCents)}</span>
            </Button>
          </div>
        </div>
      )}

      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        publicId={publicId}
        menu={menu}
        lines={lines}
        onChangeQty={changeLine}
        onSent={() => setCart([])}
      />
    </div>
  );
}

function CartPanel({
  lines,
  subtotalCents,
  canOrder,
  blockedLabel,
  onChangeQty,
  onCheckout,
}: {
  lines: readonly PricedLine[];
  subtotalCents: number;
  canOrder: boolean;
  blockedLabel: string;
  onChangeQty: (menuItemId: string, sizeId: string | null, qty: number) => void;
  onCheckout: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
        <ShoppingBag className="h-5 w-5 text-primary" /> Seu pedido
      </h2>
      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Seu carrinho está vazio. Adicione itens do cardápio.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((l) => (
            <li key={`${l.menuItemId}:${l.sizeId ?? ""}`} className="flex items-center gap-2 py-2">
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
      <div className="flex justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="font-semibold tabular-nums text-foreground">{formatBRL(subtotalCents)}</span>
      </div>
      <Button className="h-12 w-full text-base" disabled={!canOrder || lines.length === 0} onClick={onCheckout}>
        {canOrder ? "Finalizar pedido" : blockedLabel}
      </Button>
    </div>
  );
}

function MenuGroup({
  title,
  icon: Icon,
  sections,
  today,
  cart,
  canOrder,
  onChange,
}: {
  title: string;
  icon: typeof UtensilsCrossed;
  sections: readonly PublicMenuSection[];
  today: number;
  cart: Cart;
  canOrder: boolean;
  onChange: (item: PublicMenuItemDto, sizeId: string | null, qty: number) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <section className="space-y-5">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <Icon className="h-5 w-5 text-primary" /> {title}
      </h2>
      {sections.map((section) => (
        <div
          key={section.category}
          id={`cat-${section.items[0]?.kind}-${section.category}`}
          className="scroll-mt-36 space-y-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h3>
          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            {section.items.map((item) => (
              <li key={item.id} className="min-w-0">
                <MenuItemCard item={item} today={today} cart={cart} canOrder={canOrder} onChange={onChange} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function MenuItemCard({
  item,
  today,
  cart,
  canOrder,
  onChange,
}: {
  item: PublicMenuItemDto;
  today: number;
  cart: Cart;
  canOrder: boolean;
  onChange: (item: PublicMenuItemDto, sizeId: string | null, qty: number) => void;
}) {
  const offeredToday = isOfferedOn(item, today);
  const orderable = offeredToday && canOrder;
  const details = [item.volume, item.calories === null ? null : `${item.calories} kcal`].filter(Boolean).join(" · ");
  return (
    <article
      className={cn("flex h-full flex-col rounded-xl border border-border bg-card p-4", !offeredToday && "opacity-70")}
    >
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="font-semibold leading-snug text-foreground">{item.name}</h4>
            {item.popular && (
              <Badge variant="secondary" className="gap-1">
                <Star className="h-3 w-3" /> Popular
              </Badge>
            )}
          </div>
          {item.description !== null && item.description !== "" && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}
          {details !== "" && <p className="text-xs text-muted-foreground">{details}</p>}
          {item.sizes.length === 0 && (
            <p className="pt-0.5 font-semibold text-foreground">{formatBRL(startingPriceCents(item))}</p>
          )}
          {!offeredToday && (
            <p className="text-xs text-muted-foreground">Disponível: {weekdaysText(item.availableWeekdays)}</p>
          )}
        </div>
        {item.imageUrl !== null && (
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            className="h-20 w-20 shrink-0 rounded-lg object-cover sm:h-24 sm:w-24"
          />
        )}
      </div>

      {orderable &&
        (item.sizes.length === 0 ? (
          <div className="mt-auto flex justify-end pt-3">
            <Stepper label={item.name} qty={qtyOf(cart, item.id, null)} onChange={(qty) => onChange(item, null, qty)} />
          </div>
        ) : (
          <div className="mt-auto pt-3">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {item.sizes.map((size) => (
                <li key={size.id} className="flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-3">
                  <span className="min-w-0 text-sm">
                    <span className="text-muted-foreground">{size.name}</span>{" "}
                    <span className="font-semibold text-foreground">{formatBRL(size.priceCents)}</span>
                  </span>
                  <Stepper
                    label={`${item.name} ${size.name}`}
                    qty={qtyOf(cart, item.id, size.id)}
                    onChange={(qty) => onChange(item, size.id, qty)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

      {!orderable && item.sizes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {item.sizes.map((size) => (
            <li key={size.id}>
              <span className="text-muted-foreground">{size.name}</span>{" "}
              <span className="font-semibold text-foreground">{formatBRL(size.priceCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
