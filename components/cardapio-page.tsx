"use client";

import { useState } from "react";
import {
  UtensilsCrossed,
  Search,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Star,
  Flame,
  ChefHat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  menuItems as initialItems,
  categoryLabels,
  categoryColors,
  type MenuItem,
  type MenuCategory,
} from "@/lib/marmita-data";

const ALL = "todos" as const;
type FilterCategory = MenuCategory | typeof ALL;

export function CardapioPage() {
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<FilterCategory>(ALL);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // ── derived ──────────────────────────────────────────────────────────────────
  const filtered = items.filter((item) => {
    const matchCat = activeCategory === ALL || item.category === activeCategory;
    const matchSearch =
      search === "" ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const countByCategory = (cat: MenuCategory) => items.filter((i) => i.category === cat).length;
  const totalAvailable = items.filter((i) => i.available).length;

  // ── handlers ─────────────────────────────────────────────────────────────────
  const toggleAvailable = (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, available: !i.available } : i))
    );
  };

  const togglePopular = (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, popular: !i.popular } : i))
    );
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDeleteTarget(null);
    if (selectedItem?.id === id) setSelectedItem(null);
  };

  const handleSaveEdit = (updated: MenuItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setEditItem(null);
    setSelectedItem(updated);
  };

  const handleAddNew = (newItem: MenuItem) => {
    setItems((prev) => [newItem, ...prev]);
    setIsNewOpen(false);
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Left: list ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 bg-card border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Cardápio</h1>
              <p className="text-xs text-muted-foreground">
                {items.length} itens &middot; {totalAvailable} disponíveis
              </p>
            </div>
          </div>
          <Button
            onClick={() => setIsNewOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 h-9 text-sm"
          >
            <Plus className="w-4 h-4" />
            Novo item
          </Button>
        </header>

        {/* Filters + Search */}
        <div className="flex flex-col gap-3 px-6 py-3 bg-card border-b border-border shrink-0">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm bg-background border-border"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveCategory(ALL)}
              className={cn(
                "h-7 px-3 rounded-full text-xs font-medium transition-colors border",
                activeCategory === ALL
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              )}
            >
              Todos ({items.length})
            </button>
            {(Object.keys(categoryLabels) as MenuCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "h-7 px-3 rounded-full text-xs font-medium transition-colors border",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                )}
              >
                {categoryLabels[cat]} ({countByCategory(cat)})
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <ScrollArea className="flex-1">
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
                <ChefHat className="w-12 h-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Nenhum item encontrado</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Tente ajustar os filtros ou a busca</p>
              </div>
            )}
            {filtered.map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                isSelected={selectedItem?.id === item.id}
                onSelect={() => setSelectedItem(item)}
                onToggleAvailable={() => toggleAvailable(item.id)}
                onTogglePopular={() => togglePopular(item.id)}
                onEdit={() => setEditItem(item)}
                onDelete={() => setDeleteTarget(item.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Right: detail sheet (inline panel) ───────────────────────────────── */}
      {selectedItem && (
        <aside className="w-80 shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-foreground">Detalhes</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setSelectedItem(null)}
            >
              ×
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-5 flex flex-col gap-4">
              {/* Category + popular */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "text-xs font-semibold px-2.5 py-1 rounded-full",
                    categoryColors[selectedItem.category]
                  )}
                >
                  {categoryLabels[selectedItem.category]}
                </span>
                {selectedItem.popular && (
                  <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                    <Star className="w-3 h-3" />
                    Popular
                  </span>
                )}
              </div>

              {/* Name + price */}
              <div>
                <h3 className="text-lg font-bold text-foreground leading-tight">
                  {selectedItem.name}
                </h3>
                <p className="text-2xl font-bold text-primary mt-1">
                  R$ {selectedItem.price.toFixed(2).replace(".", ",")}
                </p>
              </div>

              {/* Description */}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {selectedItem.description}
              </p>

              <Separator />

              {/* Calories */}
              {selectedItem.calories && (
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span className="text-sm text-foreground font-medium">
                    {selectedItem.calories} kcal
                  </span>
                </div>
              )}

              {/* Availability */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Disponível no cardápio</p>
                  <p className="text-xs text-muted-foreground">Exibido para os clientes</p>
                </div>
                <Switch
                  checked={selectedItem.available}
                  onCheckedChange={() => {
                    toggleAvailable(selectedItem.id);
                    setSelectedItem((prev) =>
                      prev ? { ...prev, available: !prev.available } : prev
                    );
                  }}
                />
              </div>

              {/* Extras */}
              {selectedItem.extras && selectedItem.extras.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                      Adicionais disponíveis
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedItem.extras.map((extra) => (
                        <span
                          key={extra}
                          className="text-xs bg-secondary text-secondary-foreground px-2.5 py-1 rounded-full"
                        >
                          {extra}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => setEditItem(selectedItem)}
                  variant="outline"
                  className="w-full gap-2 border-border"
                >
                  <Pencil className="w-4 h-4" />
                  Editar item
                </Button>
                <Button
                  onClick={() => setDeleteTarget(selectedItem.id)}
                  variant="outline"
                  className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/5"
                >
                  <Trash2 className="w-4 h-4" />
                  Remover item
                </Button>
              </div>
            </div>
          </ScrollArea>
        </aside>
      )}

      {/* ── Edit dialog ───────────────────────────────────────────────────────── */}
      {(editItem || isNewOpen) && (
        <MenuItemFormDialog
          item={editItem ?? undefined}
          open={editItem !== null || isNewOpen}
          onClose={() => {
            setEditItem(null);
            setIsNewOpen(false);
          }}
          onSave={(item) => {
            if (editItem) {
              handleSaveEdit(item);
            } else {
              handleAddNew(item);
            }
          }}
        />
      )}

      {/* ── Delete confirm ────────────────────────────────────────────────────── */}
      <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover item</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja remover este item do cardápio? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── MenuItemCard ──────────────────────────────────────────────────────────────

interface MenuItemCardProps {
  item: MenuItem;
  isSelected: boolean;
  onSelect: () => void;
  onToggleAvailable: () => void;
  onTogglePopular: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MenuItemCard({
  item,
  isSelected,
  onSelect,
  onToggleAvailable,
  onTogglePopular,
  onEdit,
  onDelete,
}: MenuItemCardProps) {
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
      {/* Unavailable overlay */}
      {!item.available && (
        <div className="absolute inset-0 rounded-xl bg-background/60 z-10 flex items-center justify-center">
          <span className="text-xs font-semibold text-muted-foreground bg-background/90 px-3 py-1.5 rounded-full border border-border">
            Indisponível
          </span>
        </div>
      )}

      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full",
              categoryColors[item.category]
            )}
          >
            {categoryLabels[item.category]}
          </span>
          {item.popular && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Star className="w-2.5 h-2.5" />
              Popular
            </span>
          )}
        </div>
        <p className="text-base font-bold text-primary shrink-0">
          R$ {item.price.toFixed(2).replace(".", ",")}
        </p>
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-foreground leading-snug mb-1">{item.name}</h3>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        {item.calories && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Flame className="w-3 h-3 text-orange-400" />
            {item.calories} kcal
          </span>
        )}
        {!item.calories && <span />}

        {/* Action buttons — visible on hover or selected */}
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onTogglePopular}
            title={item.popular ? "Remover destaque" : "Marcar como popular"}
            className={cn(
              "w-6 h-6 flex items-center justify-center rounded-md transition-colors",
              item.popular
                ? "text-amber-500 hover:bg-amber-50"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Star className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleAvailable}
            title={item.available ? "Marcar como indisponível" : "Tornar disponível"}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            {item.available ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onEdit}
            title="Editar"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            title="Remover"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MenuItemFormDialog ────────────────────────────────────────────────────────

interface MenuItemFormDialogProps {
  item?: MenuItem;
  open: boolean;
  onClose: () => void;
  onSave: (item: MenuItem) => void;
}

function MenuItemFormDialog({ item, open, onClose, onSave }: MenuItemFormDialogProps) {
  const isNew = !item;
  const [form, setForm] = useState<Omit<MenuItem, "id">>({
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item?.price ?? 0,
    category: item?.category ?? "proteinas",
    available: item?.available ?? true,
    popular: item?.popular ?? false,
    calories: item?.calories,
    extras: item?.extras ?? [],
  });
  const [extrasInput, setExtrasInput] = useState(item?.extras?.join(", ") ?? "");

  const handleSubmit = () => {
    if (!form.name.trim() || form.price <= 0) return;
    const extras = extrasInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      id: item?.id ?? `MI-${Date.now()}`,
      ...form,
      extras,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo item no cardápio" : "Editar item"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className="text-sm">Nome *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Frango Grelhado"
              className="h-9 text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="desc" className="text-sm">Descrição</Label>
            <Textarea
              id="desc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Descreva os acompanhamentos e o preparo..."
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          {/* Price + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="price" className="text-sm">Preço (R$) *</Label>
              <Input
                id="price"
                type="number"
                min={0}
                step={0.5}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">Categoria</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as MenuCategory }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(categoryLabels) as MenuCategory[]).map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-sm">
                      {categoryLabels[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Calories */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cal" className="text-sm">Calorias (kcal)</Label>
            <Input
              id="cal"
              type="number"
              min={0}
              value={form.calories ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, calories: e.target.value ? parseInt(e.target.value) : undefined }))
              }
              placeholder="Ex: 520"
              className="h-9 text-sm"
            />
          </div>

          {/* Extras */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="extras" className="text-sm">Adicionais (separados por vírgula)</Label>
            <Input
              id="extras"
              value={extrasInput}
              onChange={(e) => setExtrasInput(e.target.value)}
              placeholder="Ex: Arroz integral, Ovo frito, Farofa extra"
              className="h-9 text-sm"
            />
          </div>

          {/* Switches */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="avail"
                  checked={form.available}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, available: v }))}
                />
                <Label htmlFor="avail" className="text-sm cursor-pointer">Disponível</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="popular"
                  checked={form.popular}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, popular: v }))}
                />
                <Label htmlFor="popular" className="text-sm cursor-pointer">Marcar como popular</Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.name.trim() || form.price <= 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isNew ? "Adicionar ao cardápio" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
