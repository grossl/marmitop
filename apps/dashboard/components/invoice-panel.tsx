"use client";

// "Nota fiscal" section of the order detail (FR-120..FR-132, FR-135, FR-139; ADR-003, ADR-015,
// ADR-016; 08.fiscal-mapping.md sections 6–8). Issue, the short "complete the data" form,
// live status while web-nf works, XML and PDF on demand, and the admin-only cancel.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, FileCode2, Loader2, Receipt, RefreshCw } from "lucide-react";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Textarea } from "@mt/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mt/ui/components/dialog";
import { cn } from "@mt/ui/lib/utils";
import type { BoardOrder, OrderDetail, OrderInvoiceView } from "@mt/http";
import {
  INVOICE_TONE_CLASSES,
  MISSING_FIELD_LABELS,
  canIssueInvoice,
  fillKey,
  formatChave,
  invoiceBadge,
  isCnpj,
  isInvoicePending,
} from "@/components/orders-format";
import {
  cancelInvoiceAction,
  getInvoiceFilesAction,
  issueInvoiceAction,
  refreshInvoiceAction,
} from "@/app/(app)/orders/invoice-actions";

const INVOICEABLE = new Set(["pronto", "saiu", "entregue"]);
const POLL_MS = 5000;
const MIN_JUSTIFICATIVA = 15;

export function InvoiceBadge({ status, kind, className }: { status: string; kind?: string; className?: string }) {
  const b = invoiceBadge(status, kind);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border leading-none",
        INVOICE_TONE_CLASSES[b.tone],
        className,
      )}
    >
      <Receipt className="w-3 h-3" aria-hidden="true" />
      {b.label}
    </span>
  );
}

type Problem = { path: string; message: string };

/** Initial values for the short form, from what the order and customer already have. */
function prefill(detail: OrderDetail | null, fields: readonly string[]): Record<string, string> {
  const known: Record<string, string | null | undefined> = {
    cpfCnpj: detail?.customerCpfCnpj,
    cep: detail?.cep,
    logradouro: detail?.logradouro,
    numero: detail?.numero,
    bairro: detail?.bairro,
    cidade: detail?.cidade,
    uf: detail?.uf,
    codigoMunicipio: detail?.codigoMunicipio,
  };
  const out: Record<string, string> = {};
  for (const f of fields) out[fillKey(f)] = known[fillKey(f)] ?? "";
  return out;
}

/** Opens a tab now (inside the click) and points it at the URL once the server answers. */
async function openFile(orderInvoiceId: string, which: "xml" | "pdf") {
  const tab = window.open("", "_blank");
  const result = await getInvoiceFilesAction({ orderInvoiceId });
  if (!result.ok) {
    tab?.close();
    toast.error(result.error.message);
    return;
  }
  const url = which === "xml" ? result.data.xmlUrl : result.data.pdfUrl;
  if (!url) {
    tab?.close();
    toast.error(which === "xml" ? "XML indisponível." : "PDF indisponível.");
    return;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export function InvoicePanel({
  order,
  detail,
  isAdmin,
  onChanged,
}: {
  order: BoardOrder;
  detail: OrderDetail | null;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [invoices, setInvoices] = useState<readonly OrderInvoiceView[]>(detail?.invoices ?? []);
  const [kind, setKind] = useState<"nfce" | "nfe">("nfce");
  const [identifyBuyer, setIdentifyBuyer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [fill, setFill] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    setInvoices(detail?.invoices ?? []);
    setProblems([]);
    setMissing([]);
    setKind("nfce");
    setIdentifyBuyer(false);
  }, [detail]);

  const latest = invoices[0] ?? null;
  const allowNfe = isCnpj(detail?.customerCpfCnpj);
  const hasDoc = !!detail?.customerCpfCnpj;
  const showIssue = INVOICEABLE.has(order.status) && canIssueInvoice(latest?.status ?? null);

  const replace = useCallback((view: OrderInvoiceView) => {
    setInvoices((prev) =>
      [view, ...prev.filter((i) => i.id !== view.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }, []);

  // Live status while web-nf works, and while a cancel waits for SEFAZ (FR-127).
  const watching = latest && (isInvoicePending(latest.status) || latest.cancelRequestedAt !== null);
  const latestId = latest?.id ?? null;
  useEffect(() => {
    if (!watching || !latestId) return;
    let stopped = false;
    const t = setInterval(async () => {
      const result = await refreshInvoiceAction({ orderInvoiceId: latestId });
      if (stopped || !result.ok) return;
      replace(result.data);
      if (!isInvoicePending(result.data.status) && result.data.cancelRequestedAt === null) onChanged();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [watching, latestId, replace, onChanged]);

  async function issue(withFill: boolean) {
    setBusy(true);
    const cleanFill = Object.fromEntries(Object.entries(fill).filter(([, v]) => v.trim() !== ""));
    const result = await issueInvoiceAction({
      orderId: order.id,
      kind,
      identifyBuyer,
      ...(withFill ? { fill: cleanFill } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      const fieldErrors = result.error.fieldErrors;
      toast.error(
        fieldErrors ? Object.values(fieldErrors).flat().join(" ") || result.error.message : result.error.message,
      );
      return;
    }
    if (result.data.outcome === "blocked") {
      setProblems(result.data.problems.map((p) => ({ path: p.path, message: p.message })));
      setMissing([...result.data.missingFields]);
      setFill(prefill(detail, result.data.missingFields));
      return;
    }
    setProblems([]);
    setMissing([]);
    replace(result.data.invoice);
    toast.success("Nota enviada para emissão.");
    onChanged();
  }

  const otherProblems = useMemo(() => problems.filter((p) => !missing.includes(p.path)), [problems, missing]);

  return (
    <div className="border-t pt-3 space-y-3" aria-label="Nota fiscal">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nota fiscal</p>
        {latest && <InvoiceBadge status={latest.status} kind={latest.kind} />}
      </div>

      {latest && (
        <div className="space-y-2 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Tipo</dt>
            <dd className="text-right">{latest.kind === "nfe" ? "NF-e" : "NFC-e"}</dd>
            {latest.numero !== null && (
              <>
                <dt className="text-muted-foreground">Número</dt>
                <dd className="text-right">
                  {latest.numero}
                  {latest.serie !== null ? ` · série ${latest.serie}` : ""}
                </dd>
              </>
            )}
            {latest.chaveAcesso && (
              <>
                <dt className="text-muted-foreground">Chave</dt>
                <dd className="text-right font-mono break-all">{formatChave(latest.chaveAcesso)}</dd>
              </>
            )}
          </dl>
          {latest.errorText && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
              {latest.errorText}
            </p>
          )}
          {latest.cancelRequestedAt && latest.status === "authorized" && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Cancelamento solicitado. Aguardando a
              SEFAZ.
            </p>
          )}
          {isInvoicePending(latest.status) && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Em processamento no serviço fiscal.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {latest.status === "authorized" && (
              <>
                <Button size="sm" variant="outline" onClick={() => void openFile(latest.id, "xml")}>
                  <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" /> Ver XML
                </Button>
                <Button size="sm" variant="outline" onClick={() => void openFile(latest.id, "pdf")}>
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Ver PDF
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const result = await refreshInvoiceAction({ orderInvoiceId: latest.id });
                if (result.ok) replace(result.data);
                else toast.error(result.error.message);
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Atualizar
            </Button>
            {isAdmin && latest.status === "authorized" && !latest.cancelRequestedAt && (
              <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancelar NF
              </Button>
            )}
          </div>
        </div>
      )}

      {showIssue && (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Tipo</span>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={kind}
                onChange={(e) => setKind(e.target.value === "nfe" ? "nfe" : "nfce")}
              >
                <option value="nfce">NFC-e</option>
                <option value="nfe" disabled={!allowNfe}>
                  NF-e{allowNfe ? "" : " (cliente sem CNPJ)"}
                </option>
              </select>
            </label>
            {order.fulfillment === "pickup" && kind === "nfce" && hasDoc && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={identifyBuyer} onChange={(e) => setIdentifyBuyer(e.target.checked)} />
                CPF na nota
              </label>
            )}
            <Button size="sm" disabled={busy} onClick={() => void issue(false)}>
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {latest ? "Emitir novamente" : "Emitir NF"}
            </Button>
          </div>

          {otherProblems.length > 0 && (
            <ul
              role="alert"
              className="list-disc space-y-0.5 rounded-md border border-amber-200 bg-amber-50 py-1.5 pl-5 pr-2 text-amber-800"
            >
              {[...new Set(otherProblems.map((p) => p.message))].map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}

          {missing.length > 0 && (
            <form
              className="space-y-2 rounded-md border p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void issue(true);
              }}
            >
              <p className="font-medium">Complete os dados do cliente para emitir:</p>
              <div className="grid grid-cols-2 gap-2">
                {[...new Set(missing)].map((path) => {
                  const key = fillKey(path);
                  return (
                    <div key={path} className="space-y-0.5">
                      <label htmlFor={`nf-fill-${order.id}-${key}`} className="text-muted-foreground">
                        {MISSING_FIELD_LABELS[path] ?? path}
                      </label>
                      <Input
                        id={`nf-fill-${order.id}-${key}`}
                        className="h-8 text-xs"
                        value={fill[key] ?? ""}
                        onChange={(e) => setFill((prev) => ({ ...prev, [key]: e.target.value }))}
                        required
                      />
                    </div>
                  );
                })}
              </div>
              <Button size="sm" type="submit" disabled={busy}>
                Salvar e emitir
              </Button>
            </form>
          )}
        </div>
      )}

      {latest && isAdmin && (
        <CancelInvoiceDialog
          open={cancelOpen}
          invoice={latest}
          onClose={() => setCancelOpen(false)}
          onDone={(view) => {
            setCancelOpen(false);
            replace(view);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function CancelInvoiceDialog({
  open,
  invoice,
  onClose,
  onDone,
}: {
  open: boolean;
  invoice: OrderInvoiceView;
  onClose: () => void;
  onDone: (view: OrderInvoiceView) => void;
}) {
  const [reason, setReason] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setWarning(
      invoice.kind === "nfce"
        ? "A SEFAZ só aceita o cancelamento de NFC-e em um prazo curto, em geral 30 minutos após a autorização."
        : null,
    );
    // The server knows the authorization time (from web-nf) and sharpens the warning (FR-130).
    void getInvoiceFilesAction({ orderInvoiceId: invoice.id }).then((r) => {
      if (r.ok) setWarning(r.data.cancelWarning);
    });
  }, [open, invoice.id, invoice.kind]);

  const length = reason.trim().length;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar {invoice.kind === "nfe" ? "NF-e" : "NFC-e"}</DialogTitle>
          <DialogDescription>O cancelamento é enviado à SEFAZ e não pode ser desfeito.</DialogDescription>
        </DialogHeader>
        {warning && (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            {warning}
          </p>
        )}
        <Textarea
          placeholder="Justificativa (mínimo 15 caracteres)"
          value={reason}
          maxLength={255}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className={cn("text-xs", length < MIN_JUSTIFICATIVA ? "text-muted-foreground" : "text-green-700")}>
          {length}/{MIN_JUSTIFICATIVA} caracteres no mínimo
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            disabled={busy || length < MIN_JUSTIFICATIVA}
            onClick={async () => {
              setBusy(true);
              const result = await cancelInvoiceAction({ orderInvoiceId: invoice.id, justificativa: reason });
              setBusy(false);
              if (!result.ok) {
                toast.error(result.error.message);
                return;
              }
              toast.success("Cancelamento solicitado.");
              onDone(result.data);
            }}
          >
            Cancelar NF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
