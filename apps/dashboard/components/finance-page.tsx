"use client";

// Finance page (ADR-020; FR-164..FR-169). Paid orders with filters, totals for the filtered set,
// and invoice issue per row or for a selected batch. The filters are a GET form, so they live in
// the URL; the server renders the first page and the totals, "Carregar mais" fetches the next.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Banknote,
  CircleHelp,
  CreditCard,
  DollarSign,
  ExternalLink,
  Landmark,
  Loader2,
  QrCode,
  Receipt,
  Search,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Checkbox } from "@mt/ui/components/checkbox";
import { Input } from "@mt/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mt/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mt/ui/components/table";
import { cn } from "@mt/ui/lib/utils";
import type { BatchIssueResult, BoardOrder, FinancePage as FinancePageData, FinanceRow, FinanceTotals } from "@mt/http";

import { issueInvoicesBatchAction, listPaidOrdersAction } from "@/app/(app)/finance/actions";
import { getOrderAction } from "@/app/(app)/orders/actions";
import { lookupCustomersAction } from "@/app/(app)/new-order/actions";
import { canIssueRow, countBatch, formatRange, INVOICE_STATE_OPTIONS, pluralOrders } from "@/components/finance-format";
import { InvoiceBadge } from "@/components/invoice-panel";
import { OrderDetailDialog } from "@/components/orders-page";
import { MISSING_FIELD_LABELS, PAYMENT_LABELS, formatCents, formatDateTime, paymentLabel } from "@/components/orders-format";
import { useRealtimeTable } from "@/lib/realtime";

type InvoiceStateValue = (typeof INVOICE_STATE_OPTIONS)[number]["value"];

interface PickedCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
}

// ─── KPI card (same look as the orders board) ────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className={cn("flex items-center justify-center w-9 h-9 rounded-lg shrink-0", color)}>
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium leading-tight">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const METHOD_CARDS = [
  { method: "pix", icon: QrCode, color: "bg-teal-100 dark:bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  { method: "dinheiro", icon: Banknote, color: "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300" },
  { method: "cartao_credito", icon: CreditCard, color: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  { method: "cartao_debito", icon: CreditCard, color: "bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300" },
] as const;

// ─── Customer picker (FR-165) ─────────────────────────────────────────────────

function CustomerPicker({ initial }: { initial: PickedCustomer | null }) {
  const [picked, setPicked] = useState<PickedCustomer | null>(initial);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void lookupCustomersAction({ q: term.trim() || undefined }).then((r) => {
        if (mine !== seq.current) return;
        if (r.ok) setOptions(r.data.map((c) => ({ id: c.id, name: c.name, phone: c.phone })));
      });
    }, 200);
    return () => clearTimeout(t);
  }, [term, open]);

  return (
    <div className="relative w-64">
      <input type="hidden" name="customer" value={picked?.id ?? ""} />
      {picked ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm">
          <span className="truncate">{picked.name}</span>
          <button
            type="button"
            aria-label="Remover filtro de cliente"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setPicked(null)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Cliente"
            placeholder="Cliente (nome ou telefone)"
            value={term}
            className="pl-9"
            onChange={(e) => setTerm(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        </>
      )}
      {open && !picked && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
        >
          {options.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPicked(c);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Batch result (FR-168) ────────────────────────────────────────────────────

function BatchResultDialog({
  results,
  onClose,
  onOpenOrder,
}: {
  results: readonly BatchIssueResult[] | null;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const counts = countBatch(results ?? []);
  const blocked = (results ?? []).filter((r) => r.outcome === "blocked");
  const skipped = (results ?? []).filter((r) => r.outcome === "skipped");
  return (
    <Dialog open={results !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resultado da emissão</DialogTitle>
          <DialogDescription>
            {counts.issued} enviada(s) para emissão · {counts.blocked} bloqueada(s) · {counts.skipped} ignorada(s)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {counts.issued > 0 && (
            <p className="rounded-md border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-3 py-2 text-green-800 dark:text-green-300">
              {pluralOrders(counts.issued)} na fila do web-nf. O status da nota atualiza sozinho na lista.
            </p>
          )}
          {blocked.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bloqueados: complete os dados no pedido
              </p>
              <ul className="space-y-2">
                {blocked.map((r) =>
                  r.outcome === "blocked" ? (
                    <li key={r.orderId} className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold">{r.code ?? r.orderId.slice(0, 8)}</span>
                        {r.code && (
                          <Button size="sm" variant="outline" onClick={() => onOpenOrder(r.orderId)}>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Abrir pedido
                          </Button>
                        )}
                      </div>
                      {r.missingFields.length > 0 && (
                        <p className="mt-1 text-xs text-amber-900 dark:text-amber-300">
                          Faltam: {r.missingFields.map((f) => MISSING_FIELD_LABELS[f] ?? f).join(", ")}
                        </p>
                      )}
                      <ul className="mt-1 list-disc pl-4 text-xs text-amber-900 dark:text-amber-300">
                        {r.problems.map((p, i) => (
                          <li key={i}>{p.message}</li>
                        ))}
                      </ul>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          {skipped.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ignorados: já têm nota em andamento ou emitida
              </p>
              <p className="font-mono text-xs">{skipped.map((r) => r.code).join(", ")}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FinancePage({
  restaurantId,
  initialPage,
  totals,
  invoiceState,
  customer,
  filterError,
}: {
  restaurantId: string;
  initialPage: FinancePageData;
  totals: FinanceTotals;
  invoiceState: InvoiceStateValue;
  customer: PickedCustomer | null;
  filterError: string | null;
}) {
  const router = useRouter();
  const { timezone } = initialPage;
  const [extra, setExtra] = useState<FinanceRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [issuing, setIssuing] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<readonly BatchIssueResult[] | null>(null);
  const [detail, setDetail] = useState<BoardOrder | null>(null);

  // A refresh (after an issue, or a Realtime invoice change) brings a new first page.
  useEffect(() => {
    setExtra([]);
    setCursor(initialPage.nextCursor);
  }, [initialPage]);

  const refresh = useCallback(() => router.refresh(), [router]);
  useRealtimeTable("order_invoices", restaurantId, refresh);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...initialPage.rows, ...extra].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }, [initialPage.rows, extra]);
  const issuable = rows.filter(canIssueRow);
  const selectedIssuable = issuable.filter((r) => selected.has(r.id));
  const allSelected = issuable.length > 0 && selectedIssuable.length === issuable.length;

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const result = await listPaidOrdersAction({
      from: initialPage.from,
      to: initialPage.to,
      customerId: customer?.id,
      invoiceState,
      cursor,
    });
    setLoadingMore(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setExtra((prev) => [...prev, ...result.data.rows]);
    setCursor(result.data.nextCursor);
  }

  async function issue(orderIds: string[]) {
    if (orderIds.length === 0) return;
    setIssuing(new Set(orderIds));
    const result = await issueInvoicesBatchAction({ orderIds });
    setIssuing(new Set());
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    const counts = countBatch(result.data.results);
    setSelected(new Set());
    if (counts.blocked === 0 && counts.skipped === 0) {
      toast.success(`${pluralOrders(counts.issued)} na fila de emissão.`);
    } else {
      setResults(result.data.results);
    }
    refresh();
  }

  async function openOrder(orderId: string) {
    const result = await getOrderAction({ orderId });
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setResults(null);
    setDetail(result.data);
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card shrink-0">
        <Wallet className="w-5 h-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Financeiro</h1>
        <span className="text-sm text-muted-foreground">
          Pedidos pagos de {formatRange(initialPage.from, initialPage.to)}
        </span>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-4">
        {/* Filters (FR-165) */}
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm shrink-0">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Cliente</span>
            <CustomerPicker initial={customer} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-from" className="text-xs font-medium text-muted-foreground">
              Pago de
            </label>
            <input
              id="finance-from"
              type="date"
              name="from"
              defaultValue={initialPage.from}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-to" className="text-xs font-medium text-muted-foreground">
              até
            </label>
            <input
              id="finance-to"
              type="date"
              name="to"
              defaultValue={initialPage.to}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="finance-invoice" className="text-xs font-medium text-muted-foreground">
              Nota fiscal
            </label>
            <select
              id="finance-invoice"
              name="invoice"
              defaultValue={invoiceState}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {INVOICE_STATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm" className="h-9">
            Filtrar
          </Button>
          <Button asChild type="button" size="sm" variant="ghost" className="h-9">
            <Link href="/finance">Limpar</Link>
          </Button>
          {filterError && <p className="w-full text-xs text-destructive">{filterError} Mostrando o mês atual.</p>}
        </form>

        {/* Totals for the filtered set (FR-166) */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6 shrink-0">
          <KpiCard
            label="Pedidos pagos"
            value={String(totals.count)}
            sub="no filtro atual"
            icon={ShoppingBag}
            color="bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300"
          />
          <KpiCard
            label="Total bruto"
            value={formatCents(totals.totalCents)}
            sub="soma dos pedidos"
            icon={DollarSign}
            color="bg-primary/10 text-primary"
          />
          {METHOD_CARDS.map(({ method, icon, color }) => (
            <KpiCard
              key={method}
              label={PAYMENT_LABELS[method] ?? method}
              value={formatCents(totals.byMethod[method].totalCents)}
              sub={pluralOrders(totals.byMethod[method].count)}
              icon={icon}
              color={color}
            />
          ))}
          {totals.byMethod.a_definir.count > 0 && (
            <KpiCard
              label="A definir"
              value={formatCents(totals.byMethod.a_definir.totalCents)}
              sub={pluralOrders(totals.byMethod.a_definir.count)}
              icon={CircleHelp}
              color="bg-slate-100 dark:bg-slate-500/15 text-slate-600 dark:text-slate-400"
            />
          )}
        </div>

        {/* Batch bar (FR-168) */}
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-sm text-muted-foreground">
            {selectedIssuable.length > 0
              ? `${pluralOrders(selectedIssuable.length)} selecionado(s)`
              : "Selecione pedidos para emitir as notas de uma vez."}
          </p>
          <Button
            size="sm"
            className="ml-auto"
            disabled={selectedIssuable.length === 0 || issuing.size > 0}
            onClick={() => void issue(selectedIssuable.map((r) => r.id))}
          >
            {issuing.size > 1 ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Receipt className="h-4 w-4" aria-hidden="true" />
            )}
            Emitir NF selecionadas
          </Button>
        </div>

        {/* Paid orders (FR-164) */}
        <div className="rounded-xl border border-border bg-card shrink-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
              <Landmark className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
              Nenhum pedido pago neste filtro.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Selecionar todos os pedidos sem nota"
                      checked={allSelected}
                      disabled={issuable.length === 0}
                      onCheckedChange={(v) => setSelected(v === true ? new Set(issuable.map((r) => r.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Nota fiscal</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const canIssue = canIssueRow(row);
                  const busy = issuing.has(row.id);
                  return (
                    <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar ${row.code}`}
                          checked={selected.has(row.id)}
                          disabled={!canIssue}
                          onCheckedChange={(v) => toggle(row.id, v === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="font-mono font-semibold text-primary hover:underline"
                          onClick={() => void openOrder(row.id)}
                        >
                          {row.code}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(row.paidAt, timezone)}</TableCell>
                      <TableCell className="max-w-48 truncate">{row.customerName}</TableCell>
                      <TableCell>{paymentLabel(row.paymentMethod)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCents(row.totalCents)}</TableCell>
                      <TableCell>
                        {row.invoice ? (
                          <span className="inline-flex items-center gap-1.5">
                            <InvoiceBadge status={row.invoice.status} />
                            {row.invoice.numero !== null && (
                              <span className="text-xs text-muted-foreground">nº {row.invoice.numero}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem nota</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canIssue && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={issuing.size > 0}
                            onClick={() => void issue([row.id])}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                            Emitir NF
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {cursor && (
          <div className="flex justify-center shrink-0 pb-2">
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Carregar mais
            </Button>
          </div>
        )}
      </div>

      <BatchResultDialog results={results} onClose={() => setResults(null)} onOpenOrder={(id) => void openOrder(id)} />
      <OrderDetailDialog
        order={detail}
        timezone={timezone}
        isAdmin
        onClose={() => setDetail(null)}
        onChanged={refresh}
      />
    </div>
  );
}
