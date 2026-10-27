import { weekdayInTimezone } from "@mt/core";
import { getPublicMenu, type PublicMenuItemDto } from "@mt/http";
import { Badge } from "@mt/ui/components/badge";
import { Button } from "@mt/ui/components/button";
import { cn } from "@mt/ui/lib/utils";
import { ChefHat, GlassWater, MessageCircle, Star, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { formatBRL } from "@/app/(app)/menu/menu-helpers";
import { requireDeps } from "@/lib/server/deps";

import {
  groupByCategory,
  isOfferedOn,
  type PublicMenuSection,
  startingPriceCents,
  weekdaysText,
  whatsappLink,
} from "./public-menu-helpers";

// Public menu page (ADR-030, FR-220–225). No session: the proxy lets /m/ through,
// and the only read is mt.public_menu by the restaurant's external id.

export const dynamic = "force-dynamic";

type Params = Promise<{ publicId: string }>;

const loadMenu = cache((publicId: string) => getPublicMenu(requireDeps(), publicId));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const menu = await loadMenu((await params).publicId);
  return {
    title: menu === null ? "Cardápio — Marmitop" : `Cardápio — ${menu.restaurantName}`,
    robots: { index: false },
  };
}

export default async function PublicMenuRoute({ params }: { params: Params }) {
  const menu = await loadMenu((await params).publicId);
  if (menu === null) notFound();

  const today = weekdayInTimezone(new Date(), menu.timezone);
  const meals = groupByCategory(menu.items, "meal");
  const drinks = groupByCategory(menu.items, "drink");
  const whatsapp = whatsappLink(menu.phone);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <ChefHat className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-foreground">{menu.restaurantName}</h1>
              <p className="text-xs text-muted-foreground">Cardápio</p>
            </div>
          </div>
          {whatsapp !== null && (
            <Button asChild className="shrink-0 gap-2">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Pedir pelo</span> WhatsApp
              </a>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-6">
        {menu.items.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">O cardápio ainda não tem itens disponíveis.</p>
        ) : (
          <>
            <MenuGroup title="Marmitas" icon={UtensilsCrossed} sections={meals} today={today} />
            <MenuGroup title="Bebidas" icon={GlassWater} sections={drinks} today={today} />
          </>
        )}
      </main>

      <footer className="pb-8 text-center text-xs text-muted-foreground">Preços sujeitos a alteração.</footer>
    </div>
  );
}

function MenuGroup({
  title,
  icon: Icon,
  sections,
  today,
}: {
  title: string;
  icon: typeof UtensilsCrossed;
  sections: readonly PublicMenuSection[];
  today: number;
}) {
  if (sections.length === 0) return null;
  return (
    <section className="space-y-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <Icon className="h-5 w-5 text-primary" /> {title}
      </h2>
      {sections.map((section) => (
        <div key={section.category} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h3>
          <ul className="space-y-3">
            {section.items.map((item) => (
              <li key={item.id}>
                <MenuItemCard item={item} today={today} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function MenuItemCard({ item, today }: { item: PublicMenuItemDto; today: number }) {
  const offeredToday = isOfferedOn(item, today);
  const details = [item.volume, item.calories === null ? null : `${item.calories} kcal`].filter(Boolean).join(" · ");
  return (
    <article className={cn("flex gap-4 rounded-xl border border-border bg-card p-4", !offeredToday && "opacity-70")}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-semibold text-foreground">{item.name}</h4>
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
        {item.sizes.length > 0 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
            {item.sizes.map((size) => (
              <li key={size.name}>
                <span className="text-muted-foreground">{size.name}</span>{" "}
                <span className="font-semibold text-foreground">{formatBRL(size.priceCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pt-1 font-semibold text-foreground">{formatBRL(startingPriceCents(item))}</p>
        )}
        <p className={cn("text-xs", offeredToday ? "font-medium text-primary" : "text-muted-foreground")}>
          {offeredToday ? "Disponível hoje" : `Disponível: ${weekdaysText(item.availableWeekdays)}`}
        </p>
      </div>
      {item.imageUrl !== null && (
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          className="h-24 w-24 shrink-0 rounded-lg object-cover"
        />
      )}
    </article>
  );
}
