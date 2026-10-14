// InvoiceGateway port (ADR-003; FR-124, FR-127, FR-129, FR-130). Adapters: WebNfGateway (http), FakeInvoiceGateway.

import type { InvoiceStatusValue } from "../fiscal/error-mapping";
import type { InvoiceEventState } from "../fiscal/invoice-lifecycle";
import type { InvoiceKind, InvoiceRequestBody } from "../fiscal/invoice-request";

export interface CreateInvoiceResult {
  readonly id: string;
  readonly status: InvoiceStatusValue;
  /** True when web-nf answered with `Idempotency-Replayed: true`. The caller treats it as success. */
  readonly replayed: boolean;
}

export interface InvoiceView {
  readonly id: string;
  readonly kind: InvoiceKind;
  /** As received. An unknown value is kept (FR-128). */
  readonly status: string;
  readonly numero: number | null;
  readonly serie: number | null;
  readonly chaveAcesso: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  /** Short-lived signed URLs. Never stored (ADR-003). */
  readonly files: { readonly xml?: string; readonly pdf?: string } | null;
  /** ISO time of the SEFAZ authorization, when web-nf reports it (the NFC-e cancel window, FR-130). */
  readonly authorizedAt?: string | null;
  /** Cancel and CC-e events, oldest first. Only `type`, `status`, and `error` are read. */
  readonly events?: readonly InvoiceEventState[];
}

export interface CancelInvoiceResult {
  readonly status: string;
}

export interface InvoiceGateway {
  createInvoice(payload: InvoiceRequestBody, idempotencyKey: string): Promise<CreateInvoiceResult>;
  getInvoice(id: string): Promise<InvoiceView>;
  /** `justificativa` has 15 to 255 characters. A new idempotency key per cancel (08 section 6.2). */
  cancelInvoice(id: string, justificativa: string, idempotencyKey: string): Promise<CancelInvoiceResult>;
  testConnection(): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}
