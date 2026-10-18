// Fiscal mapping: order -> web-nf POST /v1/invoices body (08.fiscal-mapping.md, ADR-013,
// ADR-016; FR-058, FR-120..FR-125). Pure: no I/O. The worker builds the body once,
// freezes it in `order_invoices.request_payload`, and resends that body on every retry.

import { digitsOnly, isValidCep, isValidCnpj, isValidCpf, isValidIbgeCode, isValidUf } from "../br-documents";
import { centsToReais } from "../money";
import type { Fulfillment, OrderStatus } from "../order-status";

export type InvoiceKind = "nfce" | "nfe";
export type PaymentMethod = "pix" | "dinheiro" | "cartao_credito" | "cartao_debito";

/** Structured address (ADR-016). All parts are optional text; blanks count as missing. */
export interface AddressParts {
  readonly cep?: string | null;
  readonly logradouro?: string | null;
  readonly numero?: string | null;
  readonly complemento?: string | null;
  readonly bairro?: string | null;
  readonly cidade?: string | null;
  readonly uf?: string | null;
  readonly codigoMunicipio?: string | null;
}

export interface InvoiceOrder extends AddressParts {
  readonly code: string;
  readonly status: OrderStatus;
  readonly fulfillment: Fulfillment;
  readonly paymentMethod: PaymentMethod;
  readonly changeForCents: number | null;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
}

/** `order_items` snapshot row. */
export interface InvoiceOrderItem {
  readonly menuItemId: string | null;
  readonly name: string;
  readonly sizeName: string | null;
  readonly unitPriceCents: number;
  readonly qty: number;
}

export interface InvoiceCustomer extends AddressParts {
  readonly name: string;
  readonly cpfCnpj: string | null;
}

/** Current `menu_items` row, read at invoice time (08 section 4.1). */
export interface InvoiceMenuItem {
  readonly id: string;
  readonly kind: "meal" | "drink";
  readonly ncm: string | null;
  readonly cfop: string | null;
}

/** `integrations_fiscal` plus whether the web-nf key is stored. */
export interface FiscalConfig {
  readonly baseUrl: string | null;
  readonly apiKeyConfigured: boolean;
  readonly nfceSerie: number | null;
  readonly nfeSerie: number | null;
  readonly defaultNcm: string | null;
  readonly defaultCfop: string | null;
  readonly defaultCsosn: string | null;
  readonly defaultPisCst: string | null;
  readonly defaultCofinsCst: string | null;
  readonly deliveryFeeMode: "item" | "none";
}

export interface InvoiceOptions {
  /** "CPF na nota" for a pickup order (08 section 3.3). */
  readonly identifyBuyer?: boolean;
  /** V12, known by the service from `order_invoices`. */
  readonly hasActiveInvoice?: boolean;
  /**
   * The web-nf `reference`: `order_invoices.id`, which is also the Idempotency-Key (06.api-spec.md).
   * It lets the webhook route find the row before `external_id` is stored. Defaults to the order code.
   */
  readonly reference?: string;
}

/** Same shape as web-nf `details[]`, so the UI maps `path` to a field (08 section 7). */
export interface InvoiceProblem {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface InvoiceTaxes {
  readonly icms: { readonly origem: "0"; readonly csosn: string };
  readonly pis: { readonly cst: string };
  readonly cofins: { readonly cst: string };
}

export interface InvoiceLine {
  readonly codigo: string;
  readonly descricao: string;
  readonly ncm: string;
  readonly cfop: string;
  readonly unidade: "UN";
  readonly quantidade: number;
  readonly valor_unitario: number;
  readonly impostos: InvoiceTaxes;
}

export interface InvoiceEndereco {
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento?: string;
  readonly bairro: string;
  readonly codigo_municipio: string;
  readonly municipio: string;
  readonly uf: string;
  readonly cep: string;
}

export interface InvoicePayment {
  readonly forma: PaymentMethod;
  readonly valor: number;
}

export type NfceBuyer =
  | { readonly cpf: string; readonly nome: string; readonly endereco?: InvoiceEndereco }
  | { readonly cnpj: string; readonly nome: string; readonly endereco?: InvoiceEndereco };

export type Presenca = "presencial" | "entrega_domicilio";

export interface NfceRequestBody {
  readonly kind: "nfce";
  readonly reference: string;
  readonly nfce: {
    readonly serie: number;
    readonly operacao: { readonly natureza: "Venda ao consumidor"; readonly presenca: Presenca };
    readonly destinatario?: NfceBuyer;
    readonly itens: readonly InvoiceLine[];
    readonly pagamentos: readonly InvoicePayment[];
    readonly troco?: number;
    readonly informacoes_adicionais: string;
  };
}

export interface NfeRequestBody {
  readonly kind: "nfe";
  readonly reference: string;
  readonly nfe: {
    readonly serie: number;
    readonly operacao: {
      readonly natureza: "Venda de mercadoria";
      readonly tipo: "saida";
      readonly finalidade: "normal";
      readonly consumidor_final: true;
      readonly presenca: Presenca;
    };
    readonly destinatario: NfceBuyer & {
      readonly endereco: InvoiceEndereco;
      readonly indicador_ie: "nao_contribuinte";
    };
    readonly itens: readonly InvoiceLine[];
    readonly pagamentos: readonly InvoicePayment[];
    readonly frete: { readonly modalidade: "proprio_remetente" | "sem_frete" };
    readonly informacoes_adicionais: string;
  };
}

export type InvoiceRequestBody = NfceRequestBody | NfeRequestBody;

export type BuildResult =
  | { readonly ok: true; readonly request: InvoiceRequestBody; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly problems: readonly InvoiceProblem[] };

/** SEFAZ: identification is mandatory from R$ 10.000,00 (rule V6). */
export const IDENTIFICATION_THRESHOLD_CENTS = 1_000_000;
const MAX_DESCRIPTION = 120;
const BUILTIN = { meal: { ncm: "21069090", cfop: "5101" }, drink: { ncm: null, cfop: "5102" } } as const;

const MSG = {
  v1: "Configure a integração fiscal em Configurações.",
  v4: "Defina os códigos de impostos padrão em Configurações → Fiscal.",
  v5: "Para entrega, informe CPF/CNPJ e o endereço completo do cliente.",
  v6: "Pedidos acima de R$ 10.000,00 exigem CPF ou CNPJ do cliente.",
  v7: "CPF/CNPJ inválido.",
  v8: "O total do pedido não confere com os itens. Revise o pedido.",
  v9: "O valor para troco é menor que o total.",
  v10: "NF-e exige CNPJ, razão social e endereço completo.",
  v11: "Só é possível emitir nota de pedidos prontos, em entrega ou entregues.",
  v12: "Este pedido já tem uma nota em andamento ou emitida.",
  v13: "Item com quantidade ou preço inválido.",
  v14: "O pedido tem total zero. Não há nota a emitir.",
} as const;

const blank = (v: string | null | undefined): v is null | undefined => v == null || v.trim() === "";

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function lineCode(item: InvoiceOrderItem): string {
  return item.menuItemId ? item.menuItemId.replace(/-/g, "").slice(0, 8) : fnv1a(item.name);
}

function describeItem(item: InvoiceOrderItem): string {
  const text = item.sizeName ? `${item.name} (${item.sizeName})` : item.name;
  return text.slice(0, MAX_DESCRIPTION);
}

interface ResolvedAddress {
  readonly cep: string | null;
  readonly logradouro: string | null;
  readonly numero: string | null;
  readonly complemento: string | null;
  readonly bairro: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
}

const pick = (a: string | null | undefined, b: string | null | undefined): string | null =>
  !blank(a) ? a.trim() : !blank(b) ? b.trim() : null;

/** The order address wins field by field; the customer address fills the gaps. */
function mergeAddress(order: AddressParts, customer: AddressParts): ResolvedAddress {
  return {
    cep: pick(order.cep, customer.cep),
    logradouro: pick(order.logradouro, customer.logradouro),
    numero: pick(order.numero, customer.numero),
    complemento: pick(order.complemento, customer.complemento),
    bairro: pick(order.bairro, customer.bairro),
    cidade: pick(order.cidade, customer.cidade),
    uf: pick(order.uf, customer.uf),
    codigoMunicipio: pick(order.codigoMunicipio, customer.codigoMunicipio),
  };
}

const ADDRESS_FIELDS: readonly { key: keyof ResolvedAddress; path: string; valid?: (v: string) => boolean }[] = [
  { key: "cep", path: "address.cep", valid: isValidCep },
  { key: "logradouro", path: "address.logradouro" },
  { key: "numero", path: "address.numero" },
  { key: "bairro", path: "address.bairro" },
  { key: "cidade", path: "address.cidade" },
  { key: "uf", path: "address.uf", valid: isValidUf },
  { key: "codigoMunicipio", path: "address.codigo_municipio", valid: isValidIbgeCode },
];

interface Analysis {
  readonly problems: InvoiceProblem[];
  readonly warnings: string[];
  readonly lines: InvoiceLine[];
  readonly address: ResolvedAddress;
  readonly cpfCnpj: string;
  readonly linesTotalCents: number;
}

function analyze(
  order: InvoiceOrder,
  items: readonly InvoiceOrderItem[],
  customer: InvoiceCustomer,
  config: FiscalConfig,
  menuItems: readonly InvoiceMenuItem[],
  kind: InvoiceKind,
  options: InvoiceOptions,
): Analysis {
  const problems: InvoiceProblem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const add = (path: string, code: string, message: string) => {
    const key = `${path}|${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    problems.push({ path, code, message });
  };

  const address = mergeAddress(order, customer);
  const cpfCnpj = digitsOnly(customer.cpfCnpj ?? "");
  const cpfOk = cpfCnpj.length === 11 && isValidCpf(cpfCnpj);
  const cnpjOk = cpfCnpj.length === 14 && isValidCnpj(cpfCnpj);
  const hasValidId = cpfOk || cnpjOk;
  const nonBlankName = !blank(customer.name);

  // V1
  if (blank(config.baseUrl) || !config.apiKeyConfigured) {
    add("integrations_fiscal", "fiscal_not_configured", MSG.v1);
  }
  // V2
  const serie = kind === "nfce" ? config.nfceSerie : config.nfeSerie;
  if (serie == null || !Number.isInteger(serie) || serie < 1) {
    const label = kind === "nfce" ? "NFC-e" : "NF-e";
    add(
      `integrations_fiscal.${kind === "nfce" ? "nfce_serie" : "nfe_serie"}`,
      "required",
      `Informe a série da ${label} em Configurações → Fiscal.`,
    );
  }

  // V3 and the line list
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const lines: InvoiceLine[] = [];
  const draft: { item: InvoiceOrderItem; ncm: string | null; cfop: string | null }[] = [];
  items.forEach((item, i) => {
    const menu = item.menuItemId ? byId.get(item.menuItemId) : undefined;
    if (!menu) {
      warnings.push(`Item «${item.name}» não existe mais no cardápio; usados os códigos fiscais padrão.`);
    }
    const builtin = BUILTIN[menu?.kind ?? "meal"];
    const ncm = !blank(menu?.ncm) ? (menu?.ncm as string) : !blank(config.defaultNcm) ? config.defaultNcm : builtin.ncm;
    const cfop = !blank(menu?.cfop)
      ? (menu?.cfop as string)
      : !blank(config.defaultCfop)
        ? config.defaultCfop
        : builtin.cfop;
    if (ncm == null || !/^\d{8}$/.test(ncm)) {
      add(
        `items[${i}].ncm`,
        ncm == null ? "required" : "invalid_format",
        `O item «${item.name}» está sem NCM. Preencha no cardápio.`,
      );
    }
    if (cfop == null || !/^\d{4}$/.test(cfop)) {
      add(
        `items[${i}].cfop`,
        cfop == null ? "required" : "invalid_format",
        `O item «${item.name}» está sem CFOP. Preencha no cardápio.`,
      );
    }
    draft.push({ item, ncm, cfop });
  });

  // the delivery fee line (08 section 5)
  const feeLine = order.fulfillment === "delivery" && order.deliveryFeeCents > 0 && config.deliveryFeeMode === "item";
  const feeNcm = !blank(config.defaultNcm) ? config.defaultNcm : BUILTIN.meal.ncm;
  const feeCfop = !blank(config.defaultCfop) ? config.defaultCfop : BUILTIN.meal.cfop;
  if (feeLine) {
    if (!/^\d{8}$/.test(feeNcm)) add("integrations_fiscal.default_ncm", "invalid_format", MSG.v4);
    if (!/^\d{4}$/.test(feeCfop)) add("integrations_fiscal.default_cfop", "invalid_format", MSG.v4);
  }
  if (order.fulfillment === "delivery" && order.deliveryFeeCents > 0 && config.deliveryFeeMode === "none") {
    add(
      "order.delivery_fee_cents",
      "delivery_fee_not_invoiceable",
      "A taxa de entrega não entra na nota (configuração fiscal). Ajuste o pedido para emitir.",
    );
  }

  // V4: CSOSN (derived from the CFOP) and CST
  const csosnFor = (cfop: string | null): string | null => (cfop === "5405" ? "500" : (config.defaultCsosn ?? null));
  let csosnProblem = false;
  const taxes = (cfop: string | null): InvoiceTaxes => {
    const csosn = csosnFor(cfop);
    if (csosn == null || !/^\d{3}$/.test(csosn)) csosnProblem = true;
    return {
      icms: { origem: "0", csosn: csosn ?? "" },
      pis: { cst: config.defaultPisCst ?? "" },
      cofins: { cst: config.defaultCofinsCst ?? "" },
    };
  };
  for (const d of draft) {
    lines.push({
      codigo: lineCode(d.item),
      descricao: describeItem(d.item),
      ncm: d.ncm ?? "",
      cfop: d.cfop ?? "",
      unidade: "UN",
      quantidade: d.item.qty,
      valor_unitario:
        Number.isSafeInteger(d.item.unitPriceCents) && d.item.unitPriceCents >= 0
          ? centsToReais(d.item.unitPriceCents)
          : 0,
      impostos: taxes(d.cfop),
    });
  }
  if (feeLine) {
    lines.push({
      codigo: "ENTREGA",
      descricao: "Taxa de entrega",
      ncm: feeNcm,
      cfop: feeCfop,
      unidade: "UN",
      quantidade: 1,
      valor_unitario: centsToReais(order.deliveryFeeCents),
      impostos: taxes(feeCfop),
    });
  }
  if (csosnProblem) add("integrations_fiscal.default_csosn", "required", MSG.v4);
  if (!/^\d{2}$/.test(config.defaultPisCst ?? "")) add("integrations_fiscal.default_pis_cst", "required", MSG.v4);
  if (!/^\d{2}$/.test(config.defaultCofinsCst ?? "")) add("integrations_fiscal.default_cofins_cst", "required", MSG.v4);

  // V5: delivery needs CPF/CNPJ and the full address
  const checkAddress = (message: string, fieldCode: "required") => {
    for (const f of ADDRESS_FIELDS) {
      const value = address[f.key];
      if (value == null) add(f.path, fieldCode, message);
      else if (f.valid && !f.valid(value)) add(f.path, "invalid", message);
    }
  };
  if (order.fulfillment === "delivery") {
    if (!hasValidId && cpfCnpj === "") add("customer.cpf_cnpj", "required", MSG.v5);
    checkAddress(MSG.v5, "required");
  }
  // V6
  if (order.totalCents >= IDENTIFICATION_THRESHOLD_CENTS && cpfCnpj === "") {
    add("customer.cpf_cnpj", "required", MSG.v6);
  }
  // V7
  if (cpfCnpj !== "" && !hasValidId) add("customer.cpf_cnpj", "invalid", MSG.v7);

  // V8 (skipped when the fee is already blocked, to avoid a confusing second message)
  const linesTotalCents =
    items.reduce((sum, it) => sum + it.unitPriceCents * it.qty, 0) + (feeLine ? order.deliveryFeeCents : 0);
  const feeBlocked = problems.some((p) => p.code === "delivery_fee_not_invoiceable");
  if (!feeBlocked && linesTotalCents !== order.totalCents) add("order.total_cents", "total_mismatch", MSG.v8);

  // V9
  if (order.changeForCents != null && order.changeForCents < order.totalCents) {
    add("order.change_for_cents", "invalid", MSG.v9);
  }

  // V10
  if (kind === "nfe") {
    if (!cnpjOk) add("customer.cpf_cnpj", "required", MSG.v10);
    if (!nonBlankName) add("customer.name", "required", MSG.v10);
    checkAddress(MSG.v10, "required");
  }

  // V11
  if (!(order.status === "pronto" || order.status === "saiu" || order.status === "entregue")) {
    add("order.status", "invoice_not_allowed", MSG.v11);
  }
  // V12
  if (options.hasActiveInvoice) add("order", "invoice_already_active", MSG.v12);

  // V13
  items.forEach((item, i) => {
    if (!Number.isInteger(item.qty) || item.qty <= 0) add(`items[${i}].qty`, "invalid_item", MSG.v13);
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      add(`items[${i}].unit_price_cents`, "invalid_item", MSG.v13);
    }
  });
  // V14
  if (order.totalCents <= 0) add("order.total_cents", "zero_total", MSG.v14);

  return { problems, warnings, lines, address, cpfCnpj, linesTotalCents };
}

/** Runs V1..V14 and returns the list of problems. An empty list means "go". */
export function precheckInvoice(
  order: InvoiceOrder,
  items: readonly InvoiceOrderItem[],
  customer: InvoiceCustomer,
  config: FiscalConfig,
  menuItems: readonly InvoiceMenuItem[],
  kind: InvoiceKind,
  options: InvoiceOptions = {},
): InvoiceProblem[] {
  return analyze(order, items, customer, config, menuItems, kind, options).problems;
}

/** Paths of customer and address gaps, for the short "complete the data" form (FR-125, ADR-016). */
export function missingFields(problems: readonly InvoiceProblem[]): string[] {
  return problems
    .filter((p) => p.path.startsWith("customer.") || p.path.startsWith("address.") || p.path === "paymentMethod")
    .map((p) => p.path);
}

function endereco(a: ResolvedAddress): InvoiceEndereco {
  return {
    logradouro: a.logradouro as string,
    numero: a.numero as string,
    ...(a.complemento ? { complemento: a.complemento } : {}),
    bairro: a.bairro as string,
    codigo_municipio: a.codigoMunicipio as string,
    municipio: a.cidade as string,
    uf: a.uf as string,
    cep: a.cep as string,
  };
}

function payments(order: InvoiceOrder, withChange: boolean): { pagamentos: InvoicePayment[]; troco?: number } {
  const change = order.changeForCents;
  if (withChange && order.paymentMethod === "dinheiro" && change != null && change > order.totalCents) {
    return {
      pagamentos: [{ forma: "dinheiro", valor: centsToReais(change) }],
      troco: centsToReais(change - order.totalCents),
    };
  }
  return { pagamentos: [{ forma: order.paymentMethod, valor: centsToReais(order.totalCents) }] };
}

/**
 * Build the web-nf request, or the list of problems that stop it. Signature follows 08 section 1;
 * `options` carries the "CPF na nota" choice and the active-invoice flag.
 */
export function buildInvoiceRequest(
  order: InvoiceOrder,
  items: readonly InvoiceOrderItem[],
  customer: InvoiceCustomer,
  config: FiscalConfig,
  menuItems: readonly InvoiceMenuItem[],
  kind: InvoiceKind,
  options: InvoiceOptions = {},
): BuildResult {
  const a = analyze(order, items, customer, config, menuItems, kind, options);
  if (a.problems.length > 0) return { ok: false, problems: a.problems };

  const presenca: Presenca = order.fulfillment === "delivery" ? "entrega_domicilio" : "presencial";
  const informacoes_adicionais = `Pedido ${order.code}`;
  const idKey = a.cpfCnpj.length === 14 ? "cnpj" : "cpf";

  if (kind === "nfce") {
    const identify =
      order.fulfillment === "delivery" ||
      options.identifyBuyer === true ||
      order.totalCents >= IDENTIFICATION_THRESHOLD_CENTS;
    let destinatario: NfceBuyer | undefined;
    if (identify && a.cpfCnpj !== "") {
      const base = { [idKey]: a.cpfCnpj, nome: customer.name.trim() } as { cpf: string; nome: string };
      destinatario = order.fulfillment === "delivery" ? { ...base, endereco: endereco(a.address) } : base;
    }
    const pay = payments(order, true);
    return {
      ok: true,
      warnings: a.warnings,
      request: {
        kind: "nfce",
        reference: options.reference ?? order.code,
        nfce: {
          serie: config.nfceSerie as number,
          operacao: { natureza: "Venda ao consumidor", presenca },
          ...(destinatario ? { destinatario } : {}),
          itens: a.lines,
          pagamentos: pay.pagamentos,
          ...(pay.troco !== undefined ? { troco: pay.troco } : {}),
          informacoes_adicionais,
        },
      },
    };
  }

  const pay = payments(order, false);
  return {
    ok: true,
    warnings: a.warnings,
    request: {
      kind: "nfe",
      reference: options.reference ?? order.code,
      nfe: {
        serie: config.nfeSerie as number,
        operacao: {
          natureza: "Venda de mercadoria",
          tipo: "saida",
          finalidade: "normal",
          consumidor_final: true,
          presenca,
        },
        destinatario: {
          cnpj: a.cpfCnpj,
          nome: customer.name.trim(),
          endereco: endereco(a.address),
          indicador_ie: "nao_contribuinte",
        },
        itens: a.lines,
        pagamentos: pay.pagamentos,
        frete: { modalidade: order.fulfillment === "delivery" ? "proprio_remetente" : "sem_frete" },
        informacoes_adicionais,
      },
    },
  };
}
