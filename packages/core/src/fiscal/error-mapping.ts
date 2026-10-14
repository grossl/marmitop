// web-nf error mapping (08.fiscal-mapping.md section 8; FR-127, FR-128, FR-131, FR-137).
// Maps by code, never by message text. Messages are pt-BR; the raw text goes to the detail panel only.

export type InvoiceStatusValue =
  | "received"
  | "queued"
  | "processing"
  | "authorized"
  | "rejected"
  | "denied"
  | "failed"
  | "cancelled";

export const INVOICE_STATUS_LABELS: Readonly<Record<InvoiceStatusValue, string>> = {
  received: "Em processamento",
  queued: "Em processamento",
  processing: "Em processamento",
  authorized: "Emitida",
  rejected: "Rejeitada",
  denied: "Denegada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

/** Statuses from which a webhook or poll never moves the row (FR-136). */
export const FINAL_INVOICE_STATUSES: readonly InvoiceStatusValue[] = [
  "authorized",
  "rejected",
  "denied",
  "failed",
  "cancelled",
];

/** An unknown status is kept as received and logged by the caller (FR-128). */
export function normalizeInvoiceStatus(raw: string): { status: string; known: boolean } {
  return { status: raw, known: Object.hasOwn(INVOICE_STATUS_LABELS, raw) };
}

export interface WebNfErrorMapping {
  readonly action: "stop" | "retry";
  readonly markIntegrationError: boolean;
  /** True when the error means a bug in Marmitop; the caller logs it as one. */
  readonly bug: boolean;
  readonly message: string;
}

const UNAVAILABLE = "O serviço fiscal está indisponível. Tentaremos novamente.";

const BY_CODE: Readonly<Record<string, Omit<WebNfErrorMapping, "message"> & { message: string }>> = {
  unauthorized: {
    action: "stop",
    markIntegrationError: true,
    bug: false,
    message: "A chave de acesso da integração fiscal é inválida. Atualize em Configurações → Fiscal.",
  },
  forbidden: {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "A chave da integração fiscal não tem permissão para emitir.",
  },
  not_found: {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "Nota não encontrada no serviço fiscal.",
  },
  validation_failed: { action: "stop", markIntegrationError: false, bug: false, message: "Dados da nota inválidos:" },
  certificate_missing: {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "O certificado digital A1 ainda não foi enviado ao serviço fiscal.",
  },
  csc_missing: {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "O CSC da NFC-e não está cadastrado para este ambiente (homologação ou produção).",
  },
  municipality_not_supported: {
    action: "stop",
    markIntegrationError: false,
    bug: true,
    message: "Erro interno. Tente novamente ou fale com o suporte.",
  },
  idempotency_conflict: {
    action: "stop",
    markIntegrationError: false,
    bug: true,
    message: "Esta nota já foi enviada com outros dados. Cancele e emita novamente.",
  },
  conflict: {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "A nota não está em um estado que permita esta ação.",
  },
  rate_limited: {
    action: "retry",
    markIntegrationError: false,
    bug: false,
    message: "Muitas emissões em pouco tempo. Tentaremos de novo em instantes.",
  },
  internal_error: { action: "retry", markIntegrationError: false, bug: false, message: UNAVAILABLE },
};

/** HTTP-level errors (08 section 8.1). A status of 0 means a transport failure (timeout, refused). */
export function mapWebNfError(httpStatus: number, code?: string): WebNfErrorMapping {
  if (httpStatus === 0 || httpStatus >= 500) {
    return { action: "retry", markIntegrationError: false, bug: false, message: UNAVAILABLE };
  }
  const known = code ? BY_CODE[code] : undefined;
  if (known) return known;
  return {
    action: "stop",
    markIntegrationError: false,
    bug: false,
    message: "Erro interno. Tente novamente ou fale com o suporte.",
  };
}

const OPERATION = "Erro interno nos dados da operação. Fale com o suporte.";
const FREIGHT = "Erro interno nos dados de frete. Fale com o suporte.";
const DUPLICATE = "Esta nota já foi emitida. Consulte o status.";

const SEFAZ: Readonly<Record<string, string>> = {
  "716": OPERATION,
  "717": OPERATION,
  "718": OPERATION,
  "789": OPERATION,
  "753": FREIGHT,
  "754": FREIGHT,
  "866": "O pagamento é maior que o total e falta o troco.",
  "869": "O troco informado não confere com o pagamento.",
  "539": DUPLICATE,
  "204": DUPLICATE,
  "712": "O estado não aceita emissão em contingência.",
};

/** SEFAZ rejections (08 section 8.3): a hint for known codes, the raw text for the rest. */
export function describeSefazRejection(code: string | number, text: string): string {
  return SEFAZ[String(code)] ?? `A SEFAZ recusou a nota (${code}): ${text}.`;
}

/** `validation_failed` detail paths (08 section 8.2). `itemNames` follows the `itens[]` order. */
export function mapValidationDetail(path: string, itemNames: readonly string[]): string {
  const p = path.replace(/^(nfce|nfe)\./, "");
  const item = /^itens\[(\d+)\]\.(.+)$/.exec(p);
  if (item) {
    const name = itemNames[Number(item[1])];
    const label = name ? ` «${name}»` : "";
    const field = item[2] as string;
    if (field === "ncm") return `NCM do item${label} deve ter 8 dígitos.`;
    if (field === "cfop") return `CFOP do item${label} deve ter 4 dígitos.`;
    if (field.startsWith("impostos")) return "Revise os códigos de impostos em Configurações → Fiscal.";
    return "Dados da nota inválidos.";
  }
  if (p === "destinatario.cpf" || p === "destinatario.cnpj") return "CPF/CNPJ do cliente inválido.";
  if (p === "destinatario") return "Entrega exige cliente identificado (CPF ou CNPJ).";
  if (p === "destinatario.endereco") return "Entrega exige o endereço completo do cliente.";
  if (/^destinatario\.endereco\.(cep|codigo_municipio|uf|municipio)$/.test(p)) {
    return "CEP, cidade ou UF do cliente inválido.";
  }
  if (p === "troco") return "Troco inconsistente com o pagamento.";
  if (p === "serie") return "Série inválida.";
  return "Dados da nota inválidos.";
}
