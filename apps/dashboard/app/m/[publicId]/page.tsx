import { weekdayInTimezone } from "@mt/core";
import { getPublicMenu } from "@mt/http";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { requireDeps } from "@/lib/server/deps";

import { PublicMenuClient } from "./public-menu-client";

// Public menu page with ordering (ADR-030, ADR-031; FR-220–237). No session: the proxy
// lets /m/ through, and the reads and the order go through the restaurant's external id.

export const dynamic = "force-dynamic";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

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
  const { publicId } = await params;
  const menu = await loadMenu(publicId);
  if (menu === null) notFound();
  const today = weekdayInTimezone(new Date(), menu.timezone);
  return <PublicMenuClient publicId={publicId} menu={menu} today={today} />;
}
