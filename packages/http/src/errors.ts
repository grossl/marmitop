// packages/http/src/errors.ts
//
// One mapping from anything a service throws to the error vocabulary
// (04.architecture.md "Error model", 06.api-spec.md "Error format"):
//
//   * `mapError`      → status + envelope, for apps/api and logs.
//   * `toActionError` → the serializable `{ code, message, fieldErrors }` a
//                       Server Action returns and the UI toasts.
//
// Anything that is not an AppError, a ZodError, or a known SQLSTATE becomes
// `internal_error` with a fixed message. No exception text reaches a caller
// (NFR-011).

import { AppError, type ErrorBody, type ErrorCode } from "@mt/core";
import { zodErrorToDetails } from "@mt/schemas";
import { ZodError } from "zod";

export interface MappedError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly body: ErrorBody;
  /** True when the cause was not deliberate. The caller logs it. */
  readonly unexpected: boolean;
}

const INTERNAL_MESSAGE = "The request could not be completed.";

/** SQLSTATEs a service may let through on purpose. RLS and grants raise 42501. */
const SQLSTATE_CODES: Readonly<Record<string, ErrorCode>> = {
  "23505": "conflict",
  "42501": "forbidden",
};

function fromAppError(error: AppError): MappedError {
  return { status: error.httpStatus, code: error.code, body: error.toErrorBody(), unexpected: false };
}

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) return fromAppError(error);
  if (error instanceof ZodError) {
    return fromAppError(
      new AppError("validation_failed", "The request body is invalid.", { details: zodErrorToDetails(error) }),
    );
  }
  const sqlstate = (error as { code?: unknown } | null)?.code;
  if (typeof sqlstate === "string" && SQLSTATE_CODES[sqlstate]) {
    const code = SQLSTATE_CODES[sqlstate] as ErrorCode;
    return fromAppError(new AppError(code, code === "conflict" ? "The record already exists." : "Not allowed."));
  }
  return {
    status: 500,
    code: "internal_error",
    body: { error: { code: "internal_error", message: INTERNAL_MESSAGE } },
    unexpected: true,
  };
}

/** pt-BR copy per code. It wins over a service's English message (UI text is pt-BR). */
export const ERROR_MESSAGES_PT: Readonly<Record<ErrorCode, string>> = {
  unauthorized: "Sua sessão expirou. Entre novamente.",
  forbidden: "Você não tem permissão para esta ação.",
  not_found: "Registro não encontrado.",
  validation_failed: "Alguns campos precisam de correção.",
  conflict: "Já existe um registro com estes dados.",
  idempotency_conflict: "Esta requisição já foi enviada com outro conteúdo.",
  rate_limited: "Muitas requisições. Tente novamente em instantes.",
  signature_invalid: "Assinatura inválida.",
  invalid_status_transition: "Não é possível mover o pedido para este status.",
  item_unavailable: "Item indisponível.",
  whatsapp_not_configured: "O WhatsApp não está configurado.",
  whatsapp_disconnected: "O WhatsApp está desconectado.",
  outside_service_window: "A janela de 24 horas de atendimento expirou.",
  fiscal_not_configured: "A emissão de notas não está configurada.",
  invoice_not_allowed: "O pedido não permite emitir nota agora.",
  upstream_error: "Um serviço externo falhou. Tente novamente.",
  internal_error: "Erro interno. Tente novamente.",
};

/** What a Server Action returns on failure. Plain JSON: it crosses to the browser. */
export interface ActionError {
  readonly code: ErrorCode;
  readonly message: string;
  /** `details[]` flattened to `path -> message`, first message per path. */
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export function toActionError(error: unknown): ActionError {
  const mapped = mapError(error);
  const details = mapped.body.error.details;
  let fieldErrors: Record<string, string> | undefined;
  if (details && details.length > 0) {
    fieldErrors = {};
    for (const d of details) fieldErrors[d.path] ??= d.message;
  }
  return {
    code: mapped.code,
    message: ERROR_MESSAGES_PT[mapped.code] ?? mapped.body.error.message,
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}
