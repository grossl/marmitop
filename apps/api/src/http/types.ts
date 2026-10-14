// What the api routes receive. Each phase adds its own dependency here:
// P6 adds the web-nf inbound store, P7 adds `publicApi` (PublicApiBackend) for the
// public API routes and the API-key middleware.

import type { Clock } from "@mt/core";
import type { UatisInboundStore } from "@mt/http";
import type { WebNfInboundStore } from "@mt/http";
import type { PublicApiBackend } from "@mt/http";

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
  /** POST /v1/webhooks/web-nf/{restaurant_id} (P6). Absent: not mounted. */
  readonly webNfInbound?: WebNfInboundStore;
  /** /v1/orders, /v1/customers, /v1/menu, /v1/messages behind the API key (P7). Absent: not mounted. */
  readonly publicApi?: PublicApiBackend;
}
