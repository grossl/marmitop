"use client";

import {
  UtensilsCrossed,
  Search,
  Plus,
  Pencil,
  Trash2,
  Flame,
  ChefHat,
  GlassWater,
  Calendar,
  ChevronDown,
  RulerIcon,
  X,
} from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { ScrollArea } from "@mt/ui/components/scroll-area";
import { Separator } from "@mt/ui/components/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@mt/ui/components/dialog";
import { Label } from "@mt/ui/components/label";
import { Textarea } from "@mt/ui/components/textarea";

import { cn } from "@mt/ui/lib/utils";
import type { MenuItemDto, MenuSizeDto } from "@mt/http";
import { Switch } from "@mt/ui/components/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@mt/ui/components/collapsible";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  deleteMenuItemAction,
  saveMenuItemAction,
  setMenuItemAvailabilityAction,
} from "@/app/(app)/menu/actions";
import {
  centsToInput,
  DISPLAY_WEEKDAYS,
  DRINK_CATEGORY_LABELS,
  formatBRL,
  headlinePriceCents,
  MEAL_CATEGORY_LABELS,
  menuImagePath,
  reaisToCents,
  WEEKDAY_LABELS,
} from "@/app/(app)/menu/menu-helpers";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "marmitas" | "bebidas";
type Weekday = number; // 0 = Sunday (05.data-model.md)
type Item = MenuItemDto;
type SizeOption = MenuSizeDto;

const ALL_WEEKDAYS: readonly number[] = DISPLAY_WEEKDAYS;
const weekdayLabels = WEEKDAY_LABELS;
const money = formatBRL;

// ─── Weekday pill selector ────────────────────────────────────────────────────

function WeekdayPills({
  selected,
  onChange,
}: {
  selected: Weekday[];
  onChange: (days: Weekday[]) => void;
}) {
  const toggle = (day: Weekday) => {
    onChange(
      selected.includes(day)
        ? selected.filter((d) => d !== day)
        : [...selected, day]
    );
  };
  const allSelected = ALL_WEEKDAYS.every((d) => selected.includes(d));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Dias da semana</span>
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : [...ALL_WEEKDAYS])}
          className="text-xs text-primary hover:underline"
        >
          {allSelected ? "Desmarcar todos" : "Todos os dias"}
        </button>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {ALL_WEEKDAYS.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={cn(
              "h-7 w-9 rounded-md text-xs font-semibold border transition-colors",
              selected.includes(day)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            )}
          >
            {weekdayLabels[day]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Size editor ──────────────────────────────────────────────────────────────

function SizeEditor({
  sizes,
  onChange,
}: {
  sizes: SizeOption[];
  onChange: (sizes: SizeOption[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const add = () => {
    const name = newName.trim();
    const priceCents = reaisToCents(newPrice);
    if (!name || priceCents === null) return;
    if (sizes.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Tamanho repetido.");
      return;
    }
    // No id yet: the service assigns one when it saves.
    onChange([...sizes, { id: "", name, priceCents }]);
    setNewName("");
    setNewPrice("");
  };

  const remove = (index: number) => onChange(sizes.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-3">
      {sizes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sizes.map((s, index) => (
            <div
              key={`${s.name}-${index}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50 border border-border"
            >
              <span className="text-sm font-semibold text-foreground w-12 shrink-0">{s.name}</span>
              <span className="flex-1 text-sm text-primary font-medium">
                {money(s.priceCents)}
              </span>
              <button
                type="button"
                onClick={() => remove(index)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 p-3 rounded-lg border border-dashed border-border bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground">Adicionar tamanho</p>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tamanho (P, M, G...)"
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          />
          <Input
            type="number"
            min="0"
            step="0.50"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="R$ 0,00"
            className="h-8 text-xs w-28"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          />
          <Button type="button" size="sm" variant="outline" onClick={add} className="h-8 text-xs gap-1 px-3">
            <Plus className="w-3 h-3" /> Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Menu Item Card ───────────────────────────────────────────────────────────

function MenuItemCard({
  item,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: Item;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-4 cursor-pointer transition-all duration-150",
        isSelected
          ? "border-primary ring-2 ring-primary/20 shadow-md"
          : "border-border hover:border-primary/40 hover:shadow-sm"
      )}
    >
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}{!item.available && <span className="ml-2 text-[10px] font-medium text-muted-foreground">(indisponível)</span>}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1 mb-3">
        {item.description}
      </p>

      {/* Sizes */}
      {item.sizes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {item.sizes.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary/8 border border-primary/20 text-foreground"
            >
              <span className="text-primary">{s.name}</span>
              <span className="text-muted-foreground font-normal">{money(s.priceCents)}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm font-bold text-primary mb-1">
          {money(item.priceCents)}
        </p>
      )}

      {/* Days */}
      {item.availableWeekdays && item.availableWeekdays.length > 0 && item.availableWeekdays.length < 7 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {ALL_WEEKDAYS.map((d) => (
            <span
              key={d}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                item.availableWeekdays.includes(d)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/30"
              )}
            >
              {weekdayLabels[d]}
            </span>
          ))}
        </div>
      )}
      {item.availableWeekdays.length === 7 && (
        <p className="text-[10px] text-muted-foreground mt-2">Todos os dias</p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-2">
          {item.calories && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Flame className="w-3 h-3 text-orange-400" />
              {item.calories} kcal
            </span>
          )}
        </div>
        <div
          className={cn("flex items-center gap-1 transition-opacity", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onEdit} title="Editar"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} title="Remover"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Drink Item Card ──────────────────────────────────────────────────────────

function DrinkItemCard({
  item,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: Item;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card p-4 cursor-pointer transition-all duration-150",
        isSelected ? "border-primary ring-2 ring-primary/20 shadow-md" : "border-border hover:border-primary/40 hover:shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-base font-bold text-primary shrink-0">
          {money(item.priceCents)}
        </p>
      </div>
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}{!item.available && <span className="ml-2 text-[10px] font-medium text-muted-foreground">(indisponível)</span>}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">{item.description}</p>

      {item.availableWeekdays && item.availableWeekdays.length > 0 && item.availableWeekdays.length < 7 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {ALL_WEEKDAYS.map((d) => (
            <span key={d} className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
              item.availableWeekdays.includes(d) ? "bg-primary/10 text-primary" : "text-muted-foreground/30")}>
              {weekdayLabels[d]}
            </span>
          ))}
        </div>
      )}
      {item.availableWeekdays.length === 7 && (
        <p className="text-[10px] text-muted-foreground mt-2">Todos os dias</p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <span className="text-[11px] text-muted-foreground">{item.volume ?? ""}</span>
        <div
          className={cn("flex items-center gap-1 transition-opacity", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onEdit}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Menu detail panel ────────────────────────────────────────────────────────

function MenuDetailPanel({
  item,
  onClose,
  onEdit,
  onDelete,
  onToggleAvailable,
}: {
  item: Item;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvailable: (available: boolean) => void;
}) {
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-bold text-foreground">Detalhes</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground leading-tight">{item.name}</h3>
            {item.sizes.length === 0 && (
              <p className="text-2xl font-bold text-primary mt-1">
                {money(item.priceCents)}
              </p>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>

          {/* Sizes */}
          {item.sizes.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <RulerIcon className="w-3.5 h-3.5" /> Tamanhos e Preços
                </p>
                <div className="flex flex-col gap-2">
                  {item.sizes.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 border border-border">
                      <span className="text-sm font-semibold text-foreground">{s.name}</span>
                      <span className="text-sm font-bold text-primary">{money(s.priceCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Days */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Disponivel
            </p>
            {item.availableWeekdays && item.availableWeekdays.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {ALL_WEEKDAYS.map((d) => (
                  <span
                    key={d}
                    className={cn(
                      "text-xs px-2 py-1 rounded-md font-medium border",
                      item.availableWeekdays.includes(d)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground/40 border-transparent"
                    )}
                  >
                    {weekdayLabels[d]}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum dia configurado</p>
            )}
          </div>

          {item.calories && (
            <>
              <Separator />
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-400" />
                <span className="text-sm text-foreground font-medium">{item.calories} kcal</span>
              </div>
            </>
          )}

          <Separator />
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
            Disponível para pedidos
            <Switch checked={item.available} onCheckedChange={onToggleAvailable} />
          </label>
          <Separator />
          <div className="flex flex-col gap-2">
            <Button onClick={onEdit} variant="outline" className="w-full gap-2 border-border">
              <Pencil className="w-4 h-4" /> Editar item
            </Button>
            <Button onClick={onDelete} variant="outline" className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/5">
              <Trash2 className="w-4 h-4" /> Remover item
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

// ─── Drink detail panel ───────────────────────────────────────────────────────

function DrinkDetailPanel({
  item,
  onClose,
  onEdit,
  onDelete,
  onToggleAvailable,
}: {
  item: Item;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvailable: (available: boolean) => void;
}) {
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-bold text-foreground">Detalhes da Bebida</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground leading-tight">{item.name}</h3>
            <p className="text-2xl font-bold text-primary mt-1">
              {money(item.priceCents)}
            </p>
            {item.volume && <p className="text-xs text-muted-foreground mt-0.5">{item.volume}</p>}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
          <Separator />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Disponivel
            </p>
            {item.availableWeekdays && item.availableWeekdays.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {ALL_WEEKDAYS.map((d) => (
                  <span key={d} className={cn("text-xs px-2 py-1 rounded-md font-medium border",
                    item.availableWeekdays.includes(d)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground/40 border-transparent")}>
                    {weekdayLabels[d]}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum dia configurado</p>
            )}
          </div>
          <Separator />
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
            Disponível para pedidos
            <Switch checked={item.available} onCheckedChange={onToggleAvailable} />
          </label>
          <Separator />
          <div className="flex flex-col gap-2">
            <Button onClick={onEdit} variant="outline" className="w-full gap-2 border-border">
              <Pencil className="w-4 h-4" /> Editar bebida
            </Button>
            <Button onClick={onDelete} variant="outline" className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/5">
              <Trash2 className="w-4 h-4" /> Remover bebida
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

// ─── Shared form pieces ───────────────────────────────────────────────────────

interface ActionErrorLike {
  message: string;
  fieldErrors?: Readonly<Record<string, string>>;
}

/** pt-BR toast for a failed Server Action: the first field error when there is one, else the code's message. */
function reportError(error: ActionErrorLike) {
  const firstField = error.fieldErrors ? Object.values(error.fieldErrors)[0] : undefined;
  toast.error(firstField ?? error.message);
}

/** Optional image upload with the user's session (ADR-017 exception). Returns the public URL. */
async function uploadMenuImage(restaurantId: string, folderId: string, file: File): Promise<string> {
  const path = menuImagePath(restaurantId, folderId, crypto.randomUUID(), file.type);
  if (!path) throw new Error("Use uma imagem JPEG, PNG ou WebP.");
  if (file.size > 2 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 2 MB.");
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from("menu-images").upload(path, file, { contentType: file.type });
  if (error) throw new Error("Não foi possível enviar a imagem.");
  return supabase.storage.from("menu-images").getPublicUrl(path).data.publicUrl;
}

function ImageField({
  imageUrl,
  onFile,
  onClear,
}: {
  imageUrl: string | null;
  onFile: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">Imagem (opcional)</Label>
      <div className="flex items-center gap-3">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
        )}
        <Input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="h-9 text-xs"
        />
        {imageUrl && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}

function FlagsRow({
  available,
  popular,
  onChange,
}: {
  available: boolean;
  popular: boolean;
  onChange: (patch: { available?: boolean; popular?: boolean }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-6">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={available} onCheckedChange={(v) => onChange({ available: v })} /> Disponível
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={popular} onCheckedChange={(v) => onChange({ popular: v })} /> Popular
      </label>
    </div>
  );
}

function FiscalSection({
  ncm,
  cfop,
  onChange,
}: {
  ncm: string;
  cfop: string;
  onChange: (patch: { ncm?: string; cfop?: string }) => void;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-foreground">
        Fiscal <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-sm">NCM (8 dígitos)</Label>
          <Input
            value={ncm}
            inputMode="numeric"
            maxLength={8}
            onChange={(e) => onChange({ ncm: e.target.value.replace(/\D/g, "") })}
            placeholder="Padrão do restaurante"
            className="h-9 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-sm">CFOP (4 dígitos)</Label>
          <Input
            value={cfop}
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => onChange({ cfop: e.target.value.replace(/\D/g, "") })}
            placeholder="Padrão do restaurante"
            className="h-9 text-sm"
          />
        </div>
        <p className="col-span-2 text-xs text-muted-foreground">
          Em branco, vale o padrão da configuração fiscal.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CategorySelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Readonly<Record<string, string>>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm">Categoria</Label>
      <select
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {Object.entries(options).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface FormState {
  name: string;
  description: string;
  price: string;
  category: string;
  available: boolean;
  popular: boolean;
  calories: string;
  volume: string;
  availableWeekdays: Weekday[];
  sizes: SizeOption[];
  ncm: string;
  cfop: string;
  imageUrl: string | null;
}

function initialForm(kind: "meal" | "drink", item?: Item): FormState {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item ? centsToInput(item.priceCents) : "",
    category: item?.category ?? (kind === "meal" ? "proteinas" : "refrigerantes"),
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    calories: item?.calories != null ? String(item.calories) : "",
    volume: item?.volume ?? "",
    availableWeekdays: item ? [...item.availableWeekdays] : [...ALL_WEEKDAYS],
    sizes: item ? [...item.sizes] : [],
    ncm: item?.ncm ?? "",
    cfop: item?.cfop ?? "",
    imageUrl: item?.imageUrl ?? null,
  };
}

/** Validates in the browser for fast feedback; the service validates again (FR-144). Returns a message or the payload. */
function buildPayload(kind: "meal" | "drink", id: string | undefined, form: FormState) {
  if (!form.name.trim()) return { error: "Informe o nome." } as const;
  const sizes = kind === "meal" ? form.sizes : [];
  const priceCents = sizes.length > 0 ? headlinePriceCents({ priceCents: 0, sizes }) : reaisToCents(form.price);
  if (priceCents === null) return { error: "Informe um preço válido." } as const;
  if (sizes.length === 0 && priceCents <= 0) return { error: "Informe um preço maior que zero." } as const;
  if (form.availableWeekdays.length === 0) return { error: "Escolha ao menos um dia." } as const;
  const calories = form.calories.trim() === "" ? null : Number.parseInt(form.calories, 10);
  if (kind === "meal" && calories !== null && (Number.isNaN(calories) || calories < 0)) {
    return { error: "Calorias inválidas." } as const;
  }
  return {
    payload: {
      ...(id ? { id } : {}),
      kind,
      name: form.name,
      description: form.description,
      category: form.category,
      priceCents,
      calories: kind === "meal" ? calories : null,
      volume: kind === "drink" ? form.volume : "",
      available: form.available,
      popular: form.popular,
      availableWeekdays: form.availableWeekdays,
      imageUrl: form.imageUrl ?? "",
      ncm: form.ncm,
      cfop: form.cfop,
      sizes: sizes.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, priceCents: s.priceCents })),
    },
  } as const;
}

/** Shared by both dialogs: build, upload the optional image, call the action. True when saved. */
async function submitForm(
  kind: "meal" | "drink",
  item: Item | undefined,
  form: FormState,
  file: File | null,
  folderId: string,
  restaurantId: string,
): Promise<boolean> {
  const built = buildPayload(kind, item?.id, form);
  if ("error" in built) {
    toast.error(built.error);
    return false;
  }
  let payload = built.payload;
  if (file) {
    try {
      payload = { ...payload, imageUrl: await uploadMenuImage(restaurantId, folderId, file) };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a imagem.");
      return false;
    }
  }
  const result = await saveMenuItemAction(payload);
  if (!result.ok) {
    reportError(result.error);
    return false;
  }
  toast.success(item ? "Alterações salvas." : "Item adicionado ao cardápio.");
  return true;
}

// ─── Menu Item Form ───────────────────────────────────────────────────────────

function MenuItemFormDialog({
  item,
  open,
  restaurantId,
  onClose,
  onSaved,
}: {
  item?: Item;
  open: boolean;
  restaurantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [form, setForm] = useState<FormState>(() => initialForm("meal", item));
  const [file, setFile] = useState<File | null>(null);
  const [folderId] = useState(() => item?.id ?? crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (await submitForm("meal", item, form, file, folderId, restaurantId)) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nova marmita no cardapio" : "Editar marmita"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Nome *</Label>
            <Input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ex: Frango Grelhado"
              className="h-9 text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descricao</Label>
            <Textarea
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Descreva os ingredientes e acompanhamentos..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <CategorySelect value={form.category} options={MEAL_CATEGORY_LABELS} onChange={(category) => patch({ category })} />

          {/* Price (shown only when no sizes) */}
          {form.sizes.length === 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preco base (R$) *</Label>
              <Input
                type="number"
                min="0"
                step="0.50"
                value={form.price}
                onChange={(e) => patch({ price: e.target.value })}
                placeholder="Ex: 18,90"
                className="h-9 text-sm"
              />
            </div>
          )}

          {/* Calories */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Calorias (kcal)</Label>
            <Input
              type="number"
              min="0"
              value={form.calories}
              onChange={(e) => patch({ calories: e.target.value })}
              placeholder="Ex: 520"
              className="h-9 text-sm"
            />
          </div>

          <FlagsRow available={form.available} popular={form.popular} onChange={patch} />
          <ImageField imageUrl={form.imageUrl} onFile={setFile} onClear={() => { setFile(null); patch({ imageUrl: null }); }} />

          <Separator />

          {/* Sizes */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <RulerIcon className="w-3.5 h-3.5" /> Tamanhos e Precos
            </Label>
            <p className="text-xs text-muted-foreground">
              Ao cadastrar tamanhos, o preco base e substituido pelo menor tamanho.
            </p>
            <SizeEditor sizes={form.sizes} onChange={(sizes) => patch({ sizes })} />
          </div>

          <Separator />

          {/* Weekdays */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Dias disponiveis
            </Label>
            <WeekdayPills selected={form.availableWeekdays} onChange={(days) => patch({ availableWeekdays: days })} />
          </div>

          <Separator />
          <FiscalSection ncm={form.ncm} cfop={form.cfop} onChange={patch} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isNew ? "Adicionar ao cardapio" : "Salvar alteracoes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drink Form ───────────────────────────────────────────────────────────────

function DrinkFormDialog({
  item,
  open,
  restaurantId,
  onClose,
  onSaved,
}: {
  item?: Item;
  open: boolean;
  restaurantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !item;
  const [form, setForm] = useState<FormState>(() => initialForm("drink", item));
  const [file, setFile] = useState<File | null>(null);
  const [folderId] = useState(() => item?.id ?? crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (await submitForm("drink", item, form, file, folderId, restaurantId)) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nova bebida no cardapio" : "Editar bebida"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Nome *</Label>
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Ex: Suco de Laranja" className="h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preco (R$) *</Label>
              <Input type="number" min="0" step="0.50" value={form.price} onChange={(e) => patch({ price: e.target.value })} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descricao</Label>
            <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={2} className="text-sm resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <CategorySelect value={form.category} options={DRINK_CATEGORY_LABELS} onChange={(category) => patch({ category })} />
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Volume</Label>
              <Input value={form.volume} onChange={(e) => patch({ volume: e.target.value })} placeholder="Ex: 350ml" className="h-9 text-sm" />
            </div>
          </div>
          <FlagsRow available={form.available} popular={form.popular} onChange={patch} />
          <ImageField imageUrl={form.imageUrl} onFile={setFile} onClear={() => { setFile(null); patch({ imageUrl: null }); }} />
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Dias disponiveis</Label>
            <WeekdayPills selected={form.availableWeekdays} onChange={(days) => patch({ availableWeekdays: days })} />
          </div>
          <Separator />
          <FiscalSection ncm={form.ncm} cfop={form.cfop} onChange={patch} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isNew ? "Adicionar bebida" : "Salvar alteracoes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function MenuPage({ items, restaurantId }: { items: Item[]; restaurantId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<Tab>("marmitas");

  const menuList = items.filter((i) => i.kind === "meal");
  const drinkList = items.filter((i) => i.kind === "drink");

  // Marmitas state
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [editMenu, setEditMenu] = useState<Item | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null);

  // Drinks state
  const [drinkSearch, setDrinkSearch] = useState("");
  const [selectedDrinkId, setSelectedDrinkId] = useState<string | null>(null);
  const [editDrink, setEditDrink] = useState<Item | null>(null);
  const [newDrinkOpen, setNewDrinkOpen] = useState(false);
  const [deleteDrinkId, setDeleteDrinkId] = useState<string | null>(null);

  // The selection is an id, so the panel follows the fresh server data after a refresh.
  const selectedMenu = menuList.find((i) => i.id === selectedMenuId) ?? null;
  const selectedDrink = drinkList.find((i) => i.id === selectedDrinkId) ?? null;

  const refresh = () => startTransition(() => router.refresh());

  // "Excluir" archives the item (FR-057).
  const archive = async (id: string, clearSelection: () => void) => {
    const result = await deleteMenuItemAction({ id });
    if (!result.ok) {
      reportError(result.error);
      return;
    }
    toast.success("Item removido do cardápio.");
    clearSelection();
    refresh();
  };

  const toggleAvailable = async (id: string, available: boolean) => {
    const result = await setMenuItemAvailabilityAction({ id, available });
    if (!result.ok) {
      reportError(result.error);
      return;
    }
    refresh();
  };

  // ── Marmita handlers ──────────────────────────────────────────────────────
  const filteredMenu = menuList.filter((i) => {
    const q = menuSearch.toLowerCase();
    return q === "" || i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q);
  });

  const handleDeleteMenu = async (id: string) => {
    setDeleteMenuId(null);
    await archive(id, () => selectedMenuId === id && setSelectedMenuId(null));
  };

  // ── Drink handlers ────────────────────────────────────────────────────────
  const filteredDrinks = drinkList.filter((i) => {
    const q = drinkSearch.toLowerCase();
    return q === "" || i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q);
  });

  const handleDeleteDrink = async (id: string) => {
    setDeleteDrinkId(null);
    await archive(id, () => selectedDrinkId === id && setSelectedDrinkId(null));
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 bg-card border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
              <ChefHat className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Cardápio</h1>
              <p className="text-xs text-muted-foreground">
                {activeTab === "marmitas"
                  ? `${menuList.length} marmitas`
                  : `${drinkList.length} bebidas`}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => { setActiveTab("marmitas"); setSelectedDrinkId(null); }}
              className={cn("flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-colors",
                activeTab === "marmitas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <UtensilsCrossed className="w-4 h-4" /> Marmitas
            </button>
            <button
              onClick={() => { setActiveTab("bebidas"); setSelectedMenuId(null); }}
              className={cn("flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-colors",
                activeTab === "bebidas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <GlassWater className="w-4 h-4" /> Bebidas
            </button>
          </div>

          {/* Add button */}
          <Button
            onClick={() => activeTab === "marmitas" ? setNewMenuOpen(true) : setNewDrinkOpen(true)}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            {activeTab === "marmitas" ? "Nova marmita" : "Nova bebida"}
          </Button>
        </header>

        {/* Search bar */}
        <div className="flex items-center gap-3 px-6 py-3 bg-card border-b border-border shrink-0">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            {activeTab === "marmitas" ? (
              <Input placeholder="Buscar marmita..." value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} className="pl-9 h-9 text-sm bg-background border-border" />
            ) : (
              <Input placeholder="Buscar bebida..." value={drinkSearch} onChange={(e) => setDrinkSearch(e.target.value)} className="pl-9 h-9 text-sm bg-background border-border" />
            )}
          </div>
        </div>

        {/* Grid */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6">
            {activeTab === "marmitas" ? (
              filteredMenu.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <UtensilsCrossed className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhuma marmita encontrada</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredMenu.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      isSelected={selectedMenuId === item.id}
                      onSelect={() => setSelectedMenuId(selectedMenuId === item.id ? null : item.id)}
                      onEdit={() => { setEditMenu(item); setSelectedMenuId(null); }}
                      onDelete={() => setDeleteMenuId(item.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              filteredDrinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <GlassWater className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhuma bebida encontrada</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredDrinks.map((item) => (
                    <DrinkItemCard
                      key={item.id}
                      item={item}
                      isSelected={selectedDrinkId === item.id}
                      onSelect={() => setSelectedDrinkId(selectedDrinkId === item.id ? null : item.id)}
                      onEdit={() => { setEditDrink(item); setSelectedDrinkId(null); }}
                      onDelete={() => setDeleteDrinkId(item.id)}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail panels */}
      {selectedMenu && (
        <MenuDetailPanel
          item={selectedMenu}
          onClose={() => setSelectedMenuId(null)}
          onEdit={() => { setEditMenu(selectedMenu); setSelectedMenuId(null); }}
          onDelete={() => { setDeleteMenuId(selectedMenu.id); setSelectedMenuId(null); }}
          onToggleAvailable={(available) => void toggleAvailable(selectedMenu.id, available)}
        />
      )}
      {selectedDrink && (
        <DrinkDetailPanel
          item={selectedDrink}
          onClose={() => setSelectedDrinkId(null)}
          onEdit={() => { setEditDrink(selectedDrink); setSelectedDrinkId(null); }}
          onDelete={() => { setDeleteDrinkId(selectedDrink.id); setSelectedDrinkId(null); }}
          onToggleAvailable={(available) => void toggleAvailable(selectedDrink.id, available)}
        />
      )}

      {/* Dialogs. Mounted only while open so each opening starts from fresh form state. */}
      {newMenuOpen && (
        <MenuItemFormDialog
          open
          restaurantId={restaurantId}
          onClose={() => setNewMenuOpen(false)}
          onSaved={() => { setNewMenuOpen(false); refresh(); }}
        />
      )}
      {editMenu && (
        <MenuItemFormDialog
          item={editMenu}
          open
          restaurantId={restaurantId}
          onClose={() => setEditMenu(null)}
          onSaved={() => { setEditMenu(null); refresh(); }}
        />
      )}

      {newDrinkOpen && (
        <DrinkFormDialog
          open
          restaurantId={restaurantId}
          onClose={() => setNewDrinkOpen(false)}
          onSaved={() => { setNewDrinkOpen(false); refresh(); }}
        />
      )}
      {editDrink && (
        <DrinkFormDialog
          item={editDrink}
          open
          restaurantId={restaurantId}
          onClose={() => setEditDrink(null)}
          onSaved={() => { setEditDrink(null); refresh(); }}
        />
      )}

      {/* Delete confirm (archives, FR-057) */}
      <Dialog open={!!deleteMenuId} onOpenChange={() => setDeleteMenuId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover marmita?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">A marmita sai do cardapio. Pedidos antigos nao mudam.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteMenuId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteMenuId && void handleDeleteMenu(deleteMenuId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteDrinkId} onOpenChange={() => setDeleteDrinkId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover bebida?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">A bebida sai do cardapio. Pedidos antigos nao mudam.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDrinkId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDrinkId && void handleDeleteDrink(deleteDrinkId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
