"use client";

import { MessageCircle, ClipboardList, Users, UtensilsCrossed, BookOpen, Boxes, PlusCircle, Settings, BarChart3, LogOut, Wallet, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@mt/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@mt/ui/components/tooltip";

import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@mt/ui/components/dropdown-menu";
import { logoutAction } from "@/lib/auth-actions";
import { navItemsFor, type Role, type Section, sectionForPath } from "@/lib/nav";

// FR-002 (logout), FR-005/FR-007 (items by role). The server gates each page
// too; hiding an item here is a convenience, not the check.

const ICONS: Record<Section, React.ElementType> = {
  "new-order": PlusCircle,
  messages: MessageCircle,
  orders: ClipboardList,
  contacts: Users,
  menu: BookOpen,
  stock: Boxes,
  reports: BarChart3,
  finance: Wallet,
  settings: Settings,
};

interface NavSidebarProps {
  role: Role;
  restaurantName: string;
  userEmail?: string;
  unreadCount?: number;
  newOrdersCount?: number;
}

// ADR-022: per-browser theme preference. Render a neutral icon until mounted
// so the server and first client render match.
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const Icon = !mounted || theme === "system" || !theme ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <div className="w-full px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tema"
            data-theme-switch
            className="flex items-center justify-center w-full h-10 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuRadioGroup value={mounted ? (theme ?? "system") : "system"} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light"><Sun className="w-4 h-4" aria-hidden="true" /> Claro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon className="w-4 h-4" aria-hidden="true" /> Escuro</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor className="w-4 h-4" aria-hidden="true" /> Sistema</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function NavSidebar({ role, restaurantName, userEmail, unreadCount = 0, newOrdersCount = 0 }: NavSidebarProps) {
  const active = sectionForPath(usePathname());
  const getBadge = (id: Section) => {
    if (id === "messages" && unreadCount > 0) return unreadCount;
    if (id === "orders" && newOrdersCount > 0) return newOrdersCount;
    return undefined;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className="flex flex-col items-center gap-1 h-full w-14 bg-sidebar border-r border-sidebar-border py-4 shrink-0"
        aria-label="Navegação principal"
      >
        {/* Logo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary mb-5" aria-label={`Marmitop — ${restaurantName}`}>
              <UtensilsCrossed className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {restaurantName}
          </TooltipContent>
        </Tooltip>

        {/* Nav items */}
        <div className="flex flex-col gap-1 flex-1 w-full px-2">
          {navItemsFor(role).map(({ id, label, href }) => {
            const Icon = ICONS[id];
            const badge = getBadge(id);
            const isActive = active === id;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    data-nav-item={id}
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
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <ThemeSwitch />

        {/* Logout */}
        <form action={logoutAction} className="w-full px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                aria-label="Sair"
                className="flex items-center justify-center w-full h-10 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              >
                <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {userEmail ? `Sair (${userEmail})` : "Sair"}
            </TooltipContent>
          </Tooltip>
        </form>
      </nav>
    </TooltipProvider>
  );
}
