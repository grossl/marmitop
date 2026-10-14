// What the api routes receive. Each phase adds its own dependency here:
// P6 adds the web-nf inbound store, P7 adds `services` (ServiceDeps) for the
// public API routes and the API-key middleware.

import type { Clock } from "@mt/core";
import type { UatisInboundStore } from "@mt/http";

export interface ApiLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ApiDeps {
  readonly clock: Clock;
  readonly log: ApiLogger;
  /** POST /v1/webhooks/uatis/{restaurant_id} (P5). */
  readonly uatisInbound: UatisInboundStore;
}
