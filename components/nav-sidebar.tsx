"use client";

import { MessageCircle, ClipboardList, Users, BarChart3, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Section } from "@/lib/marmita-data";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface NavItem {
  id: Section;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: "mensagens",  label: "Mensagens",  icon: MessageCircle },
  { id: "pedidos",    label: "Pedidos",    icon: ClipboardList },
  { id: "contatos",   label: "Contatos",   icon: Users },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
];

interface NavSidebarProps {
  active: Section;
  onSelect: (section: Section) => void;
  unreadCount?: number;
  newOrdersCount?: number;
}

export function NavSidebar({ active, onSelect, unreadCount = 0, newOrdersCount = 0 }: NavSidebarProps) {
  const getBadge = (id: Section) => {
    if (id === "mensagens" && unreadCount > 0) return unreadCount;
    if (id === "pedidos" && newOrdersCount > 0) return newOrdersCount;
    return undefined;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className="flex flex-col items-center gap-1 h-full w-14 bg-sidebar border-r border-sidebar-border py-4 shrink-0"
        aria-label="Navegação principal"
      >
        {/* Logo */}
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary mb-5">
          <UtensilsCrossed className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-1 flex-1 w-full px-2">
          {navItems.map(({ id, label, icon: Icon }) => {
            const badge = getBadge(id);
            const isActive = active === id;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelect(id)}
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex items-center justify-center w-full h-10 rounded-lg transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                    {badge !== undefined && (
                      <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </TooltipProvider>
  );
}
