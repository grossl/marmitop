// Screens, routes, and who may open them (ADR-004 routes, ADR-005 roles,
// FR-005, FR-007). The nav sidebar hides items with `navItemsFor`; admin-only
// pages call `requireScreen` (server) which uses `canOpen`. Client-safe.

export type Role = "admin" | "attendant";

export type Section =
  | "new-order"
  | "messages"
  | "orders"
  | "contacts"
  | "menu"
  | "stock"
  | "reports"
  | "settings";

export interface NavItem {
  readonly id: Section;
  readonly label: string;
  readonly href: `/${Section}`;
  readonly minRole: Role;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "new-order", label: "Novo pedido", href: "/new-order", minRole: "attendant" },
  { id: "messages", label: "Mensagens", href: "/messages", minRole: "attendant" },
  { id: "orders", label: "Pedidos", href: "/orders", minRole: "attendant" },
  { id: "contacts", label: "Contatos", href: "/contacts", minRole: "attendant" },
  { id: "menu", label: "Cardápio", href: "/menu", minRole: "admin" },
  { id: "stock", label: "Estoque", href: "/stock", minRole: "admin" },
  { id: "reports", label: "Relatórios", href: "/reports", minRole: "admin" },
  { id: "settings", label: "Configurações", href: "/settings", minRole: "admin" },
];

export const HOME_PATH = "/messages";

export function canOpen(role: Role, section: Section): boolean {
  const item = NAV_ITEMS.find((i) => i.id === section);
  if (!item) return false;
  return item.minRole === "attendant" || role === "admin";
}

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => canOpen(role, i.id));
}

export function sectionForPath(pathname: string): Section | undefined {
  return NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.id;
}
