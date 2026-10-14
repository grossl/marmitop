"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Archive, History, PackagePlus, Pencil, Search, SlidersHorizontal } from "lucide-react";
import type { StockItemDto, StockMovementDto } from "@mt/http";
import { Input } from "@mt/ui/components/input";
import { Button } from "@mt/ui/components/button";
import { Badge } from "@mt/ui/components/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@mt/ui/components/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@mt/ui/components/sheet";
import { Label } from "@mt/ui/components/label";

import {
  archiveStockItemAction,
  listStockMovementsAction,
  recordStockMovementAction,
  saveStockItemAction,
} from "@/app/(app)/stock/actions";
import { centsToInput, formatBRL, reaisToCents } from "@/app/(app)/menu/menu-helpers";
import { formatMovementDelta, formatQty, MOVEMENT_LABELS, parseQty, UNIT_OPTIONS } from "@/app/(app)/stock/stock-helpers";

type Category = StockItemDto["category"];
type MovementKind = "in" | "out" | "adjust";

function reportError(error: { message: string; fieldErrors?: Readonly<Record<string, string>> }) {
  const field = error.fieldErrors ? Object.values(error.fieldErrors)[0] : undefined;
  toast.error(field ?? error.message);
}

interface ItemForm {
  name: string;
  unit: string;
  category: Category;
  current: string;
  minimum: string;
  cost: string;
}

const emptyForm: ItemForm = { name: "", unit: "un", category: "insumos", current: "", minimum: "", cost: "" };

function formFromItem(item: StockItemDto): ItemForm {
  return {
    name: item.name,
    unit: item.unit,
    category: item.category,
    current: "",
    minimum: String(item.minimumQty),
    cost: centsToInput(item.unitCostCents),
  };
}

export function StockPage({
  items,
  lowCount,
  totalValueCents,
}: {
  items: StockItemDto[];
  lowCount: number;
  totalValueCents: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todos");
  // `editing`: null = closed, "new" = creating, an item = editing it.
  const [editing, setEditing] = useState<StockItemDto | "new" | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<{ item: StockItemDto; kind: MovementKind } | null>(null);
  const [movement, setMovement] = useState({ qty: "", reason: "" });
  const [history, setHistory] = useState<StockItemDto | null>(null);
  const [historyRows, setHistoryRows] = useState<StockMovementDto[] | null>(null);
  const [archiving, setArchiving] = useState<StockItemDto | null>(null);

  const filtered = useMemo(
    () => items.filter((item) => (category === "todos" || item.category === category) && item.name.toLowerCase().includes(query.toLowerCase())),
    [items, query, category],
  );

  const openEditor = (target: StockItemDto | "new") => {
    setForm(target === "new" ? emptyForm : formFromItem(target));
    setEditing(target);
  };

  const saveItem = async () => {
    const minimumQty = parseQty(form.minimum, { signed: false });
    const unitCostCents = reaisToCents(form.cost.replace(",", ".") || "0");
    if (!form.name.trim()) return toast.error("Informe o nome.");
    if (minimumQty === null) return toast.error("Estoque mínimo inválido.");
    if (unitCostCents === null) return toast.error("Custo unitário inválido.");
    let initialQty: number | undefined;
    if (editing === "new" && form.current.trim() !== "") {
      const parsed = parseQty(form.current, { signed: false });
      if (parsed === null) return toast.error("Quantidade atual inválida.");
      initialQty = parsed;
    }
    setSaving(true);
    try {
      const result = await saveStockItemAction({
        ...(editing !== "new" && editing ? { id: editing.id } : {}),
        name: form.name,
        unit: form.unit,
        category: form.category,
        minimumQty,
        unitCostCents,
        ...(initialQty !== undefined ? { initialQty } : {}),
      });
      if (!result.ok) return reportError(result.error);
      toast.success(editing === "new" ? "Produto cadastrado." : "Produto atualizado.");
      setEditing(null);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const openMovement = (item: StockItemDto, kind: MovementKind) => {
    setMovement({ qty: "", reason: "" });
    setMoving({ item, kind });
  };

  const recordMovement = async () => {
    if (!moving) return;
    const qty = parseQty(movement.qty, { signed: moving.kind === "adjust" });
    if (qty === null) return toast.error("Quantidade inválida.");
    setSaving(true);
    try {
      const result = await recordStockMovementAction({
        stockItemId: moving.item.id,
        kind: moving.kind,
        qty,
        reason: movement.reason,
      });
      if (!result.ok) return reportError(result.error);
      toast.success("Movimentação registrada.");
      setMoving(null);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiving) return;
    const result = await archiveStockItemAction({ id: archiving.id });
    if (!result.ok) return reportError(result.error);
    toast.success("Produto arquivado.");
    setArchiving(null);
    refresh();
  };

  // Movement history for one item (FR-066). Reloads when the item list refreshes after a new movement.
  useEffect(() => {
    if (!history) return;
    let cancelled = false;
    setHistoryRows(null);
    void listStockMovementsAction({ stockItemId: history.id }).then((result) => {
      if (cancelled) return;
      if (result.ok) setHistoryRows(result.data);
      else {
        reportError(result.error);
        setHistoryRows([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [history, items]);

  return (
    <section className="h-full overflow-auto bg-background p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operação</p><h1 className="mt-1 text-2xl font-bold">Estoque</h1><p className="mt-1 text-sm text-muted-foreground">Controle insumos, embalagens e bebidas vendidos.</p></div>
        <Button className="gap-2" onClick={() => openEditor("new")}><PackagePlus className="h-4 w-4" /> Novo produto</Button>
      </header>
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Itens cadastrados</p><p className="mt-2 text-2xl font-bold">{items.length}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Estoque baixo</p><p className="mt-2 text-2xl font-bold text-amber-600">{lowCount}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Valor em estoque</p><p className="mt-2 text-2xl font-bold">{formatBRL(totalValueCents)}</p></div></div>
      <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar produto..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>{["todos", "insumos", "embalagens", "bebidas"].map((cat) => <Button key={cat} variant={category === cat ? "default" : "outline"} onClick={() => setCategory(cat)}>{cat[0].toUpperCase() + cat.slice(1)}</Button>)}</div>
      <div className="overflow-hidden rounded-xl border bg-card"><div className="hidden grid-cols-[1.5fr_100px_130px_130px_270px] gap-4 border-b px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Produto</span><span>Atual</span><span>Mínimo</span><span>Valor</span><span>Ações</span></div>{filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>}{filtered.map((item) => <div key={item.id} className="grid gap-3 border-b px-5 py-4 last:border-0 md:grid-cols-[1.5fr_100px_130px_130px_270px] md:items-center md:gap-4"><div><p className="font-semibold">{item.name}</p><div className="mt-1 flex gap-2"><Badge variant="secondary">{item.category}</Badge>{item.low && <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Repor</span>}</div></div><span className={item.low ? "font-bold text-amber-600" : "font-semibold"}>{formatQty(item.currentQty)} {item.unit}</span><span className="text-sm text-muted-foreground">{formatQty(item.minimumQty)} {item.unit}</span><span className="text-sm">{formatBRL(Math.round(item.currentQty * item.unitCostCents))}</span><div className="flex gap-2"><Button size="sm" variant="outline" title="Saída" onClick={() => openMovement(item, "out")}><ArrowDown className="h-4 w-4" /></Button><Button size="sm" variant="outline" title="Entrada" onClick={() => openMovement(item, "in")}><ArrowUp className="h-4 w-4" /></Button><Button size="sm" variant="outline" title="Ajuste" onClick={() => openMovement(item, "adjust")}><SlidersHorizontal className="h-4 w-4" /></Button><Button size="sm" variant="outline" title="Histórico" onClick={() => setHistory(item)}><History className="h-4 w-4" /></Button><Button size="sm" variant="outline" title="Editar" onClick={() => openEditor(item)}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="outline" title="Arquivar" onClick={() => setArchiving(item)}><Archive className="h-4 w-4" /></Button></div></div>)}</div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>{editing === "new" ? "Cadastrar produto no estoque" : "Editar produto"}</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><div><Label>Nome do produto</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Unidade</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}{!UNIT_OPTIONS.some((u) => u.value === form.unit) && <option value={form.unit}>{form.unit}</option>}</select></div><div><Label>Categoria</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}><option value="insumos">Insumos</option><option value="embalagens">Embalagens</option><option value="bebidas">Bebidas</option></select></div></div><div className="grid grid-cols-3 gap-3"><div><Label>Quantidade atual</Label><Input className="mt-1" type="number" min="0" step="0.001" disabled={editing !== "new"} placeholder={editing === "new" ? "" : "Use movimentação"} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></div><div><Label>Estoque mínimo</Label><Input className="mt-1" type="number" min="0" step="0.001" value={form.minimum} onChange={(e) => setForm({ ...form, minimum: e.target.value })} /></div><div><Label>Custo unitário</Label><Input className="mt-1" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={saving} onClick={() => void saveItem()}>{editing === "new" ? "Cadastrar produto" : "Salvar"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={moving !== null} onOpenChange={(o) => !o && setMoving(null)}><DialogContent><DialogHeader><DialogTitle>{moving ? `${MOVEMENT_LABELS[moving.kind]}: ${moving.item.name}` : ""}</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><div><Label>{moving?.kind === "adjust" ? `Diferença (${moving.item.unit}, use - para reduzir)` : `Quantidade (${moving?.item.unit ?? ""})`}</Label><Input className="mt-1" inputMode="decimal" value={movement.qty} onChange={(e) => setMovement({ ...movement, qty: e.target.value })} /></div><div><Label>Motivo (opcional)</Label><Input className="mt-1" value={movement.reason} maxLength={200} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setMoving(null)}>Cancelar</Button><Button disabled={saving} onClick={() => void recordMovement()}>Registrar</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={archiving !== null} onOpenChange={(o) => !o && setArchiving(null)}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Arquivar produto?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{archiving?.name} sai das listas e do valor em estoque. O histórico fica guardado.</p><DialogFooter><Button variant="outline" onClick={() => setArchiving(null)}>Cancelar</Button><Button variant="destructive" onClick={() => void archive()}>Arquivar</Button></DialogFooter></DialogContent></Dialog>

      <Sheet open={history !== null} onOpenChange={(o) => !o && setHistory(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>Histórico: {history?.name}</SheetTitle></SheetHeader><div className="px-4 pb-4">{historyRows === null ? <p className="text-sm text-muted-foreground">Carregando...</p> : historyRows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma movimentação.</p> : <ul className="divide-y">{historyRows.map((m) => <li key={m.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{MOVEMENT_LABELS[m.kind] ?? m.kind}</p><p className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString("pt-BR")}</p>{m.reason && <p className="mt-0.5 text-xs text-muted-foreground">{m.reason}</p>}</div><div className="text-right"><p className="font-semibold">{formatMovementDelta(m.kind, m.qty)} {history?.unit}</p><p className="text-xs text-muted-foreground">Saldo {formatQty(m.balanceAfter)}</p></div></li>)}</ul>}</div></SheetContent></Sheet>
    </section>
  );
}

export default StockPage;
