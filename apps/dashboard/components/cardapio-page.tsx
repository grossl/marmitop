"use client";

import { useState } from "react";
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
import {
  menuItems as initialMenuItems,
  drinkItems as initialDrinkItems,
  weekdayLabels,
  ALL_WEEKDAYS,
  type MenuItem,
  type DrinkItem,
  type Weekday,
  type SizeOption,
  type MenuCategory,
  type DrinkCategory,
} from "@/lib/marmita-data";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "marmitas" | "bebidas";

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
    const price = parseFloat(newPrice);
    if (!name || isNaN(price) || price < 0) return;
    onChange([...sizes, { id: `sz-${Date.now()}`, name, price }]);
    setNewName("");
    setNewPrice("");
  };

  const remove = (id: string) => onChange(sizes.filter((s) => s.id !== id));

  return (
    <div className="flex flex-col gap-3">
      {sizes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sizes.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50 border border-border"
            >
              <span className="text-sm font-semibold text-foreground w-12 shrink-0">{s.name}</span>
              <span className="flex-1 text-sm text-primary font-medium">
                R$ {s.price.toFixed(2).replace(".", ",")}
              </span>
              <button
                type="button"
                onClick={() => remove(s.id)}
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
  item: MenuItem;
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
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1 mb-3">
        {item.description}
      </p>

      {/* Sizes */}
      {item.sizes && item.sizes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {item.sizes.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary/8 border border-primary/20 text-foreground"
            >
              <span className="text-primary">{s.name}</span>
              <span className="text-muted-foreground font-normal">R$ {s.price.toFixed(2).replace(".", ",")}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm font-bold text-primary mb-1">
          R$ {item.price.toFixed(2).replace(".", ",")}
        </p>
      )}

      {/* Days */}
      {item.availableDays && item.availableDays.length > 0 && item.availableDays.length < 7 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {ALL_WEEKDAYS.map((d) => (
            <span
              key={d}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                item.availableDays!.includes(d)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/30"
              )}
            >
              {weekdayLabels[d]}
            </span>
          ))}
        </div>
      )}
      {item.availableDays?.length === 7 && (
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
  item: DrinkItem;
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
          R$ {item.price.toFixed(2).replace(".", ",")}
        </p>
      </div>
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">{item.description}</p>

      {item.availableDays && item.availableDays.length > 0 && item.availableDays.length < 7 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {ALL_WEEKDAYS.map((d) => (
            <span key={d} className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
              item.availableDays!.includes(d) ? "bg-primary/10 text-primary" : "text-muted-foreground/30")}>
              {weekdayLabels[d]}
            </span>
          ))}
        </div>
      )}
      {item.availableDays?.length === 7 && (
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
}: {
  item: MenuItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-bold text-foreground">Detalhes</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground leading-tight">{item.name}</h3>
            {(!item.sizes || item.sizes.length === 0) && (
              <p className="text-2xl font-bold text-primary mt-1">
                R$ {item.price.toFixed(2).replace(".", ",")}
              </p>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>

          {/* Sizes */}
          {item.sizes && item.sizes.length > 0 && (
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
                      <span className="text-sm font-bold text-primary">R$ {s.price.toFixed(2).replace(".", ",")}</span>
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
            {item.availableDays && item.availableDays.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {ALL_WEEKDAYS.map((d) => (
                  <span
                    key={d}
                    className={cn(
                      "text-xs px-2 py-1 rounded-md font-medium border",
                      item.availableDays!.includes(d)
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
}: {
  item: DrinkItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h2 className="text-sm font-bold text-foreground">Detalhes da Bebida</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground leading-tight">{item.name}</h3>
            <p className="text-2xl font-bold text-primary mt-1">
              R$ {item.price.toFixed(2).replace(".", ",")}
            </p>
            {item.volume && <p className="text-xs text-muted-foreground mt-0.5">{item.volume}</p>}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
          <Separator />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Disponivel
            </p>
            {item.availableDays && item.availableDays.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {ALL_WEEKDAYS.map((d) => (
                  <span key={d} className={cn("text-xs px-2 py-1 rounded-md font-medium border",
                    item.availableDays!.includes(d)
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

// ─── Menu Item Form ───────────────────────────────────────────────────────────

function MenuItemFormDialog({
  item,
  open,
  onClose,
  onSave,
}: {
  item?: MenuItem;
  open: boolean;
  onClose: () => void;
  onSave: (item: MenuItem) => void;
}) {
  const isNew = !item;
  const [form, setForm] = useState<{
    name: string;
    description: string;
    price: number;
    category: MenuCategory;
    available: boolean;
    popular: boolean;
    calories: number | undefined;
    availableDays: Weekday[];
    sizes: SizeOption[];
  }>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? 0,
    category: item?.category ?? "proteinas",
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    calories: item?.calories,
    availableDays: item?.availableDays ?? [...ALL_WEEKDAYS],
    sizes: item?.sizes ?? [],
  });

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    // If sizes exist, price = lowest size price; else require price > 0
    const price = form.sizes.length > 0
      ? Math.min(...form.sizes.map((s) => s.price))
      : form.price;
    if (form.sizes.length === 0 && form.price <= 0) return;
    onSave({ id: item?.id ?? `MI-${Date.now()}`, ...form, price });
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
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Frango Grelhado"
              className="h-9 text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descricao</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descreva os ingredientes e acompanhamentos..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          {/* Price (shown only when no sizes) */}
          {form.sizes.length === 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preco base (R$) *</Label>
              <Input
                type="number"
                min="0"
                step="0.50"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
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
              value={form.calories ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value ? parseInt(e.target.value) : undefined }))}
              placeholder="Ex: 520"
              className="h-9 text-sm"
            />
          </div>

          <Separator />

          {/* Sizes */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <RulerIcon className="w-3.5 h-3.5" /> Tamanhos e Precos
            </Label>
            <p className="text-xs text-muted-foreground">
              Ao cadastrar tamanhos, o preco base e substituido pelo menor tamanho.
            </p>
            <SizeEditor
              sizes={form.sizes}
              onChange={(sizes) => setForm((f) => ({ ...f, sizes }))}
            />
          </div>

          <Separator />

          {/* Weekdays */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Dias disponiveis
            </Label>
            <WeekdayPills
              selected={form.availableDays}
              onChange={(days) => setForm((f) => ({ ...f, availableDays: days }))}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90">
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
  onClose,
  onSave,
}: {
  item?: DrinkItem;
  open: boolean;
  onClose: () => void;
  onSave: (item: DrinkItem) => void;
}) {
  const isNew = !item;
  const [form, setForm] = useState<{
    name: string;
    description: string;
    price: number;
    category: DrinkCategory;
    available: boolean;
    popular: boolean;
    volume: string;
    availableDays: Weekday[];
  }>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? 0,
    category: item?.category ?? "refrigerantes",
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    volume: item?.volume ?? "",
    availableDays: item?.availableDays ?? [...ALL_WEEKDAYS],
  });

  const handleSubmit = () => {
    if (!form.name.trim() || form.price <= 0) return;
    onSave({ id: item?.id ?? `DR-${Date.now()}`, ...form });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nova bebida no cardapio" : "Editar bebida"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Suco de Laranja" className="h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preco (R$) *</Label>
              <Input type="number" min="0" step="0.50" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descricao</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="text-sm resize-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Volume</Label>
            <Input value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} placeholder="Ex: 350ml" className="h-9 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Dias disponiveis</Label>
            <WeekdayPills selected={form.availableDays} onChange={(days) => setForm((f) => ({ ...f, availableDays: days }))} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isNew ? "Adicionar bebida" : "Salvar alteracoes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CardapioPage() {
  const [activeTab, setActiveTab] = useState<Tab>("marmitas");

  // Marmitas state
  const [menuList, setMenuList] = useState<MenuItem[]>(initialMenuItems);
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedMenu, setSelectedMenu] = useState<MenuItem | null>(null);
  const [editMenu, setEditMenu] = useState<MenuItem | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null);

  // Drinks state
  const [drinkList, setDrinkList] = useState<DrinkItem[]>(initialDrinkItems);
  const [drinkSearch, setDrinkSearch] = useState("");
  const [selectedDrink, setSelectedDrink] = useState<DrinkItem | null>(null);
  const [editDrink, setEditDrink] = useState<DrinkItem | null>(null);
  const [newDrinkOpen, setNewDrinkOpen] = useState(false);
  const [deleteDrinkId, setDeleteDrinkId] = useState<string | null>(null);

  // ── Marmita handlers ──────────────────────────────────────────────────────
  const filteredMenu = menuList.filter((i) => {
    const q = menuSearch.toLowerCase();
    return q === "" || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
  });

  const handleDeleteMenu = (id: string) => {
    setMenuList((p) => p.filter((i) => i.id !== id));
    setDeleteMenuId(null);
    if (selectedMenu?.id === id) setSelectedMenu(null);
  };

  const handleSaveMenu = (updated: MenuItem) => {
    if (editMenu) {
      setMenuList((p) => p.map((i) => i.id === updated.id ? updated : i));
      setSelectedMenu(updated);
      setEditMenu(null);
    } else {
      setMenuList((p) => [updated, ...p]);
      setNewMenuOpen(false);
    }
  };

  // ── Drink handlers ────────────────────────────────────────────────────────
  const filteredDrinks = drinkList.filter((i) => {
    const q = drinkSearch.toLowerCase();
    return q === "" || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
  });

  const handleDeleteDrink = (id: string) => {
    setDrinkList((p) => p.filter((i) => i.id !== id));
    setDeleteDrinkId(null);
    if (selectedDrink?.id === id) setSelectedDrink(null);
  };

  const handleSaveDrink = (updated: DrinkItem) => {
    if (editDrink) {
      setDrinkList((p) => p.map((i) => i.id === updated.id ? updated : i));
      setSelectedDrink(updated);
      setEditDrink(null);
    } else {
      setDrinkList((p) => [updated, ...p]);
      setNewDrinkOpen(false);
    }
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
              <h1 className="text-base font-bold text-foreground">Cardapio</h1>
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
              onClick={() => { setActiveTab("marmitas"); setSelectedDrink(null); }}
              className={cn("flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-colors",
                activeTab === "marmitas" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              <UtensilsCrossed className="w-4 h-4" /> Marmitas
            </button>
            <button
              onClick={() => { setActiveTab("bebidas"); setSelectedMenu(null); }}
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
        <ScrollArea className="flex-1">
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
                      isSelected={selectedMenu?.id === item.id}
                      onSelect={() => setSelectedMenu(selectedMenu?.id === item.id ? null : item)}
                      onEdit={() => { setEditMenu(item); setSelectedMenu(null); }}
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
                      isSelected={selectedDrink?.id === item.id}
                      onSelect={() => setSelectedDrink(selectedDrink?.id === item.id ? null : item)}
                      onEdit={() => { setEditDrink(item); setSelectedDrink(null); }}
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
          onClose={() => setSelectedMenu(null)}
          onEdit={() => { setEditMenu(selectedMenu); setSelectedMenu(null); }}
          onDelete={() => { setDeleteMenuId(selectedMenu.id); setSelectedMenu(null); }}
        />
      )}
      {selectedDrink && (
        <DrinkDetailPanel
          item={selectedDrink}
          onClose={() => setSelectedDrink(null)}
          onEdit={() => { setEditDrink(selectedDrink); setSelectedDrink(null); }}
          onDelete={() => { setDeleteDrinkId(selectedDrink.id); setSelectedDrink(null); }}
        />
      )}

      {/* Dialogs */}
      <MenuItemFormDialog
        open={newMenuOpen}
        onClose={() => setNewMenuOpen(false)}
        onSave={handleSaveMenu}
      />
      {editMenu && (
        <MenuItemFormDialog
          item={editMenu}
          open={!!editMenu}
          onClose={() => setEditMenu(null)}
          onSave={handleSaveMenu}
        />
      )}

      <DrinkFormDialog
        open={newDrinkOpen}
        onClose={() => setNewDrinkOpen(false)}
        onSave={handleSaveDrink}
      />
      {editDrink && (
        <DrinkFormDialog
          item={editDrink}
          open={!!editDrink}
          onClose={() => setEditDrink(null)}
          onSave={handleSaveDrink}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteMenuId} onOpenChange={() => setDeleteMenuId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover marmita?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta acao nao pode ser desfeita.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteMenuId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteMenuId && handleDeleteMenu(deleteMenuId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteDrinkId} onOpenChange={() => setDeleteDrinkId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover bebida?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Esta acao nao pode ser desfeita.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDrinkId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDrinkId && handleDeleteDrink(deleteDrinkId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
