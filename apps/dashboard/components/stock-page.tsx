"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, PackagePlus, Search } from "lucide-react";
import { Input } from "@mt/ui/components/input";
import { Button } from "@mt/ui/components/button";
import { Badge } from "@mt/ui/components/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@mt/ui/components/dialog";
import { Label } from "@mt/ui/components/label";
import type { StockItem } from "@/lib/marmita-data";

const initialStock: StockItem[] = [
  { id: "st-1", name: "Arroz branco", unit: "kg", current: 18, minimum: 10, cost: 6.5, category: "insumos" },
  { id: "st-2", name: "Feijão carioca", unit: "kg", current: 7, minimum: 8, cost: 8.9, category: "insumos" },
  { id: "st-3", name: "Frango", unit: "kg", current: 24, minimum: 12, cost: 14.9, category: "insumos" },
  { id: "st-4", name: "Carne bovina", unit: "kg", current: 5, minimum: 8, cost: 31.5, category: "insumos" },
  { id: "st-5", name: "Marmita 500ml", unit: "un", current: 96, minimum: 40, cost: 0.85, category: "embalagens" },
  { id: "st-6", name: "Tampa 500ml", unit: "un", current: 28, minimum: 40, cost: 0.35, category: "embalagens" },
  { id: "st-7", name: "Água 500ml", unit: "un", current: 42, minimum: 20, cost: 2.1, category: "bebidas" },
  { id: "st-8", name: "Coca-Cola lata", unit: "un", current: 12, minimum: 24, cost: 3.2, category: "bebidas" },
];

export function StockPage() {
  const [items, setItems] = useState<StockItem[]>(initialStock);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; unit: string; current: string; minimum: string; cost: string; category: StockItem["category"] }>({ name: "", unit: "un", current: "", minimum: "", cost: "", category: "insumos" });
  const filtered = useMemo(() => items.filter((item) => (category === "todos" || item.category === category) && item.name.toLowerCase().includes(query.toLowerCase())), [items, query, category]);
  const low = items.filter((item) => item.current <= item.minimum).length;
  const totalValue = items.reduce((sum, item) => sum + item.current * item.cost, 0);
  const adjust = (id: string, amount: number) => setItems((all) => all.map((item) => item.id === id ? { ...item, current: Math.max(0, item.current + amount) } : item));
  const addItem = () => {
    if (!form.name.trim() || !form.current || !form.minimum || !form.cost) return;
    setItems((all) => [...all, { id: `st-${Date.now()}`, name: form.name.trim(), unit: form.unit, current: Number(form.current), minimum: Number(form.minimum), cost: Number(form.cost), category: form.category }]);
    setForm({ name: "", unit: "un", current: "", minimum: "", cost: "", category: "insumos" });
    setOpen(false);
  };

  return (
    <section className="h-full overflow-auto bg-background p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operação</p><h1 className="mt-1 text-2xl font-bold">Estoque</h1><p className="mt-1 text-sm text-muted-foreground">Controle insumos, embalagens e bebidas vendidos.</p></div>
        <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="gap-2"><PackagePlus className="h-4 w-4" /> Novo produto</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Cadastrar produto no estoque</DialogTitle></DialogHeader><div className="grid gap-4 py-2"><div><Label>Nome do produto</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Unidade</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option value="un">Unidade</option><option value="kg">Kg</option><option value="l">Litro</option><option value="cx">Caixa</option></select></div><div><Label>Categoria</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as StockItem["category"] })}><option value="insumos">Insumos</option><option value="embalagens">Embalagens</option><option value="bebidas">Bebidas</option></select></div></div><div className="grid grid-cols-3 gap-3"><div><Label>Quantidade atual</Label><Input className="mt-1" type="number" min="0" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></div><div><Label>Estoque mínimo</Label><Input className="mt-1" type="number" min="0" value={form.minimum} onChange={(e) => setForm({ ...form, minimum: e.target.value })} /></div><div><Label>Custo unitário</Label><Input className="mt-1" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={addItem}>Cadastrar produto</Button></DialogFooter></DialogContent></Dialog>
      </header>
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Itens cadastrados</p><p className="mt-2 text-2xl font-bold">{items.length}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Estoque baixo</p><p className="mt-2 text-2xl font-bold text-amber-600">{low}</p></div><div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Valor em estoque</p><p className="mt-2 text-2xl font-bold">R$ {totalValue.toFixed(2).replace(".", ",")}</p></div></div>
      <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[260px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar produto..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>{["todos", "insumos", "embalagens", "bebidas"].map((cat) => <Button key={cat} variant={category === cat ? "default" : "outline"} onClick={() => setCategory(cat)}>{cat[0].toUpperCase() + cat.slice(1)}</Button>)}</div>
      <div className="overflow-hidden rounded-xl border bg-card"><div className="hidden grid-cols-[1.5fr_100px_130px_130px_180px] gap-4 border-b px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Produto</span><span>Atual</span><span>Mínimo</span><span>Valor</span><span>Ações</span></div>{filtered.map((item) => { const isLow = item.current <= item.minimum; return <div key={item.id} className="grid gap-3 border-b px-5 py-4 last:border-0 md:grid-cols-[1.5fr_100px_130px_130px_180px] md:items-center md:gap-4"><div><p className="font-semibold">{item.name}</p><div className="mt-1 flex gap-2"><Badge variant="secondary">{item.category}</Badge>{isLow && <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> Repor</span>}</div></div><span className={isLow ? "font-bold text-amber-600" : "font-semibold"}>{item.current} {item.unit}</span><span className="text-sm text-muted-foreground">{item.minimum} {item.unit}</span><span className="text-sm">R$ {(item.current * item.cost).toFixed(2).replace(".", ",")}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => adjust(item.id, -1)}><ArrowDown className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => adjust(item.id, 1)}><ArrowUp className="h-4 w-4" /></Button></div></div>})}</div>
    </section>
  );
}

export default StockPage;
