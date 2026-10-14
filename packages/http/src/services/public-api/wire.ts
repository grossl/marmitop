// Wire helpers for the public API (06.api-spec.md "Error format", FR-144).
// Services speak camelCase; the HTTP API speaks snake_case. The envelope always
// carries `details` (06.openapi.yaml `ErrorEnvelope` requires it).

import type { ErrorCode, ErrorDetail } from "@mt/core";

import { mapError } from "../../errors";

export interface WireErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly details: ErrorDetail[] };
}

export interface WireError {
  readonly status: number;
  readonly body: WireErrorBody;
  /** True for a 5xx the caller must log. */
  readonly unexpected: boolean;
}

/** Only camelCase identifiers change; header names such as `Idempotency-Key` stay. */
const snake = (segment: string) =>
  /^[a-z][A-Za-z0-9]*$/.test(segment) ? segment.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) : segment;

/** `items[0].menuItemId` → `items[0].menu_item_id`. Index brackets stay. */
export function snakePath(path: string): string {
  return path
    .split(".")
    .map((part) => part.replace(/^[^[]+/, (name) => snake(name)))
    .join(".");
}

export function toWireError(error: unknown): WireError {
  const mapped = mapError(error);
  const details = (mapped.body.error.details ?? []).map((d) => ({ ...d, path: snakePath(d.path) }));
  return {
    status: mapped.status,
    unexpected: mapped.unexpected,
    body: { error: { code: mapped.code, message: mapped.body.error.message, details } },
  };
}
