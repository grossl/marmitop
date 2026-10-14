// Screens, routes, and who may open them (ADR-004 routes, ADR-005 roles,
// FR-005, FR-007). The nav sidebar hides items with `navItemsFor`; admin-only
// pages call `requireScreen` (server) which uses `canOpen`. Client-safe.

export type Role = "admin" | "attendant";

export type Section =
  | "novo-pedido"
  | "mensagens"
  | "pedidos"
  | "contatos"
  | "cardapio"
  | "estoque"
  | "relatorios"
  | "configuracoes";

export interface NavItem {
  readonly id: Section;
  readonly label: string;
  readonly href: `/${Section}`;
  readonly minRole: Role;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "novo-pedido", label: "Novo pedido", href: "/novo-pedido", minRole: "attendant" },
  { id: "mensagens", label: "Mensagens", href: "/mensagens", minRole: "attendant" },
  { id: "pedidos", label: "Pedidos", href: "/pedidos", minRole: "attendant" },
  { id: "contatos", label: "Contatos", href: "/contatos", minRole: "attendant" },
  { id: "cardapio", label: "Cardápio", href: "/cardapio", minRole: "admin" },
  { id: "estoque", label: "Estoque", href: "/estoque", minRole: "admin" },
  { id: "relatorios", label: "Relatórios", href: "/relatorios", minRole: "admin" },
  { id: "configuracoes", label: "Configurações", href: "/configuracoes", minRole: "admin" },
];

export const HOME_PATH = "/mensagens";

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
