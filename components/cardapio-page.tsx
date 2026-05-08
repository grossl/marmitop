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
  ListPlus,
  X,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { cn } from "@/lib/utils";
import {
  menuItems as initialMenuItems,
  drinkItems as initialDrinkItems,
  weekdayLabels,
  ALL_WEEKDAYS,
  type MenuItem,
  type DrinkItem,
  type Weekday,
  type SubItem,
} from "@/lib/marmita-data";

// ─── Types & constants ────────────────────────────────────────────────────────

type Tab = "marmitas" | "bebidas";

// ─── Weekday pill ─────────────────────────────────────────────────────────────

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

// ─── SubItem editor ───────────────────────────────────────────────────────────

function SubItemEditor({
  subItems,
  onChange,
}: {
  subItems: SubItem[];
  onChange: (items: SubItem[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [newRequired, setNewRequired] = useState(false);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    onChange([
      ...subItems,
      {
        id: `si-${Date.now()}`,
        name,
        price: parseFloat(newPrice) || 0,
        required: newRequired,
      },
    ]);
    setNewName("");
    setNewPrice("0");
    setNewRequired(false);
  };

  const remove = (id: string) => onChange(subItems.filter((s) => s.id !== id));

  return (
    <div className="flex flex-col gap-3">
      {/* Existing sub-items */}
      {subItems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {subItems.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm"
            >
              <span className="flex-1 text-foreground">{s.name}</span>
              {s.price > 0 && (
                <span className="text-xs text-primary font-medium shrink-0">
                  +R$ {s.price.toFixed(2).replace(".", ",")}
                </span>
              )}
              {s.price === 0 && (
                <span className="text-xs text-muted-foreground shrink-0">Incluso</span>
              )}
              {s.required && (
                <Badge variant="secondary" className="text-[10px] shrink-0">Obrig.</Badge>
              )}
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new */}
      <div className="flex flex-col gap-2 p-3 rounded-lg border border-dashed border-border bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground">Adicionar sub-item</p>
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome (ex: Arroz integral)"
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          />
          <Input
            type="number"
            min="0"
            step="0.5"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Preço"
            className="h-8 text-xs w-20"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id="required-toggle"
              checked={newRequired}
              onCheckedChange={setNewRequired}
              className="scale-75"
            />
            <Label htmlFor="required-toggle" className="text-xs text-muted-foreground cursor-pointer">
              Obrigatório
            </Label>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={add} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" />
            Adicionar
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
  onToggleAvailable,
  onTogglePopular,
  onEdit,
  onDelete,
}: {
  item: MenuItem;
  isSelected: boolean;
  onSelect: () => void;
  onToggleAvailable: () => void;
  onTogglePopular: () => void;
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
      {!item.available && (
        <div className="absolute inset-0 rounded-xl bg-background/60 z-10 flex items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground bg-background/90 px-3 py-1.5 rounded-full border border-border">
            Indisponível
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.popular && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Star className="w-2.5 h-2.5" /> Popular
            </span>
          )}
        </div>
        <p className="text-base font-bold text-primary shrink-0">
          R$ {item.price.toFixed(2).replace(".", ",")}
        </p>
      </div>
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Days row */}
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
          {item.subItems && item.subItems.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ListPlus className="w-3 h-3" />
              {item.subItems.length} sub-itens
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
  onToggleAvailable,
  onTogglePopular,
  onEdit,
  onDelete,
}: {
  item: DrinkItem;
  isSelected: boolean;
  onSelect: () => void;
  onToggleAvailable: () => void;
  onTogglePopular: () => void;
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
      {!item.available && (
        <div className="absolute inset-0 rounded-xl bg-background/60 z-10 flex items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground bg-background/90 px-3 py-1.5 rounded-full border border-border">
            Indisponível
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.popular && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Star className="w-2.5 h-2.5" /> Popular
            </span>
          )}
        </div>
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

// ─── Menu item detail panel ───────────────────���───────────────────────────────

function MenuDetailPanel({
  item,
  onClose,
  onEdit,
  onDelete,
  onToggleAvailable,
}: {
  item: MenuItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvailable: (id: string) => void;
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
          {item.popular && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                <Star className="w-3 h-3" /> Popular
              </span>
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold text-foreground leading-tight">{item.name}</h3>
            <p className="text-2xl font-bold text-primary mt-1">
              R$ {item.price.toFixed(2).replace(".", ",")}
            </p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>

          <Separator />

          {/* Dias da semana */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Disponível
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

          <Separator />

          {/* Sub-itens */}
          {item.subItems && item.subItems.length > 0 && (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ListPlus className="w-3.5 h-3.5" /> Sub-itens / Opções
                </p>
                <div className="flex flex-col gap-1.5">
                  {item.subItems.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className={cn("w-3.5 h-3.5 shrink-0", s.required ? "text-primary" : "text-muted-foreground/50")} />
                      <span className="flex-1 text-foreground">{s.name}</span>
                      {s.price > 0 ? (
                        <span className="text-primary font-medium">+R$ {s.price.toFixed(2).replace(".", ",")}</span>
                      ) : (
                        <span className="text-muted-foreground">Incluso</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <Separator />
            </>
          )}

          {item.calories && (
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-foreground font-medium">{item.calories} kcal</span>
            </div>
          )}

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
  item: DrinkItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAvailable: (id: string) => void;
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
          {item.popular && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                <Star className="w-3 h-3" /> Popular
              </span>
            </div>
          )}
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
              <Calendar className="w-3.5 h-3.5" /> Disponível
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
  const [form, setForm] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? 0,
    category: (item?.category ?? "proteinas") as MenuCategory,
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    calories: item?.calories ?? undefined as number | undefined,
    availableDays: item?.availableDays ?? [...ALL_WEEKDAYS] as Weekday[],
    subItems: item?.subItems ?? [] as SubItem[],
    extras: item?.extras ?? [] as string[],
  });
  const [extrasInput, setExtrasInput] = useState(item?.extras?.join(", ") ?? "");

  const handleSubmit = () => {
    if (!form.name.trim() || form.price <= 0) return;
    const extras = extrasInput.split(",").map((s) => s.trim()).filter(Boolean);
    onSave({ id: item?.id ?? `MI-${Date.now()}`, ...form, extras });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nova marmita no cardápio" : "Editar marmita"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 py-2">
          {/* Row 1: name + price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Frango Grelhado" className="h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preço (R$) *</Label>
              <Input type="number" min="0" step="0.5" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))} className="h-9 text-sm" />
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descrição</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Descreva os ingredientes e acompanhamentos..." rows={2} className="text-sm resize-none" />
          </div>

          {/* Calorias */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Calorias (kcal)</Label>
            <Input type="number" min="0" value={form.calories ?? ""} onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value ? parseInt(e.target.value) : undefined }))} placeholder="Ex: 520" className="h-9 text-sm" />
          </div>

          {/* Weekdays */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Dias disponíveis</Label>
            <WeekdayPills selected={form.availableDays} onChange={(days) => setForm((f) => ({ ...f, availableDays: days }))} />
          </div>

          <Separator />

          {/* Sub-items */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5"><ListPlus className="w-3.5 h-3.5" /> Sub-itens / Opções de montagem</Label>
            <SubItemEditor subItems={form.subItems} onChange={(items) => setForm((f) => ({ ...f, subItems: items }))} />
          </div>

          <Separator />

          {/* Extras */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Adicionais (separados por vírgula)</Label>
            <Input value={extrasInput} onChange={(e) => setExtrasInput(e.target.value)} placeholder="Ex: Arroz integral, Feijão preto, Farofa extra" className="h-9 text-sm" />
          </div>

        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isNew ? "Adicionar ao cardápio" : "Salvar alterações"}
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
  const [form, setForm] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? 0,
    category: (item?.category ?? "refrigerantes") as DrinkCategory,
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    volume: item?.volume ?? "",
    availableDays: item?.availableDays ?? [...ALL_WEEKDAYS] as Weekday[],
  });

  const handleSubmit = () => {
    if (!form.name.trim() || form.price <= 0) return;
    onSave({ id: item?.id ?? `DR-${Date.now()}`, ...form });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Nova bebida no cardápio" : "Editar bebida"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Suco de Laranja" className="h-9 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Preço (R$) *</Label>
              <Input type="number" min="0" step="0.5" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Descrição</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="text-sm resize-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Volume</Label>
            <Input value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} placeholder="Ex: 350ml" className="h-9 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Dias disponíveis</Label>
            <WeekdayPills selected={form.availableDays} onChange={(days) => setForm((f) => ({ ...f, availableDays: days }))} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isNew ? "Adicionar bebida" : "Salvar alterações"}
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

  const toggleMenuAvailable = (id: string) => {
    setMenuList((p) => p.map((i) => i.id === id ? { ...i, available: !i.available } : i));
    setSelectedMenu((p) => p?.id === id ? { ...p, available: !p.available } : p);
  };
  const toggleMenuPopular = (id: string) => setMenuList((p) => p.map((i) => i.id === id ? { ...i, popular: !i.popular } : i));
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

  const toggleDrinkAvailable = (id: string) => {
    setDrinkList((p) => p.map((i) => i.id === id ? { ...i, available: !i.available } : i));
    setSelectedDrink((p) => p?.id === id ? { ...p, available: !p.available } : p);
  };
  const toggleDrinkPopular = (id: string) => setDrinkList((p) => p.map((i) => i.id === id ? { ...i, popular: !i.popular } : i));
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

  const totalMenuAvailable = menuList.filter((i) => i.available).length;
  const totalDrinkAvailable = drinkList.filter((i) => i.available).length;

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
                  ? `${menuList.length} marmitas · ${totalMenuAvailable} disponíveis`
                  : `${drinkList.length} bebidas · ${totalDrinkAvailable} disponíveis`}
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

          <Button
            onClick={() => activeTab === "marmitas" ? setNewMenuOpen(true) : setNewDrinkOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 h-9 text-sm"
          >
            <Plus className="w-4 h-4" />
            {activeTab === "marmitas" ? "Nova marmita" : "Nova bebida"}
          </Button>
        </header>

        {/* Filters */}
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
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeTab === "marmitas" ? (
              filteredMenu.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                  <ChefHat className="w-12 h-12 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">Nenhuma marmita encontrada</p>
                </div>
              ) : filteredMenu.map((item) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedMenu?.id === item.id}
                  onSelect={() => { setSelectedMenu(item); setSelectedDrink(null); }}
                  onToggleAvailable={() => toggleMenuAvailable(item.id)}
                  onTogglePopular={() => toggleMenuPopular(item.id)}
                  onEdit={() => setEditMenu(item)}
                  onDelete={() => setDeleteMenuId(item.id)}
                />
              ))
            ) : (
              filteredDrinks.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                  <GlassWater className="w-12 h-12 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">Nenhuma bebida encontrada</p>
                </div>
              ) : filteredDrinks.map((item) => (
                <DrinkItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedDrink?.id === item.id}
                  onSelect={() => { setSelectedDrink(item); setSelectedMenu(null); }}
                  onToggleAvailable={() => toggleDrinkAvailable(item.id)}
                  onTogglePopular={() => toggleDrinkPopular(item.id)}
                  onEdit={() => setEditDrink(item)}
                  onDelete={() => setDeleteDrinkId(item.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail panels */}
      {selectedMenu && activeTab === "marmitas" && (
        <MenuDetailPanel
          item={selectedMenu}
          onClose={() => setSelectedMenu(null)}
          onEdit={() => setEditMenu(selectedMenu)}
          onDelete={() => setDeleteMenuId(selectedMenu.id)}
          onToggleAvailable={toggleMenuAvailable}
        />
      )}
      {selectedDrink && activeTab === "bebidas" && (
        <DrinkDetailPanel
          item={selectedDrink}
          onClose={() => setSelectedDrink(null)}
          onEdit={() => setEditDrink(selectedDrink)}
          onDelete={() => setDeleteDrinkId(selectedDrink.id)}
          onToggleAvailable={toggleDrinkAvailable}
        />
      )}

      {/* Marmita form dialogs */}
      {(editMenu || newMenuOpen) && (
        <MenuItemFormDialog
          item={editMenu ?? undefined}
          open={editMenu !== null || newMenuOpen}
          onClose={() => { setEditMenu(null); setNewMenuOpen(false); }}
          onSave={handleSaveMenu}
        />
      )}
      {(editDrink || newDrinkOpen) && (
        <DrinkFormDialog
          item={editDrink ?? undefined}
          open={editDrink !== null || newDrinkOpen}
          onClose={() => { setEditDrink(null); setNewDrinkOpen(false); }}
          onSave={handleSaveDrink}
        />
      )}

      {/* Delete confirms */}
      <Dialog open={deleteMenuId !== null} onOpenChange={() => setDeleteMenuId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remover marmita</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja remover este item do cardápio?</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteMenuId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteMenuId && handleDeleteMenu(deleteMenuId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteDrinkId !== null} onOpenChange={() => setDeleteDrinkId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remover bebida</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Tem certeza que deseja remover esta bebida do cardápio?</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDrinkId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDrinkId && handleDeleteDrink(deleteDrinkId)}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Filter pill helper ───────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-xs font-medium transition-colors border",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
