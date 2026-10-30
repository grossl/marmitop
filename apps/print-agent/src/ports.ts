// The agent's two outside dependencies, as ports (NFR-061, ADR-038).

/** The ticket data of a claimed job (06.api-spec.md "Print jobs"), snake_case as on the wire. */
export interface WireTicket {
  readonly restaurant_name: string;
  readonly timezone: string;
  readonly customer_name: string;
  readonly customer_phone: string | null;
  readonly order: {
    readonly code: string;
    readonly fulfillment: "delivery" | "pickup";
    readonly source: "counter" | "phone" | "whatsapp" | "api" | "menu";
    readonly created_at: string;
    readonly notes: string | null;
    readonly logradouro: string | null;
    readonly numero: string | null;
    readonly complemento: string | null;
    readonly bairro: string | null;
    readonly cidade: string | null;
    readonly uf: string | null;
    readonly cep: string | null;
    readonly payment_method: "pix" | "dinheiro" | "cartao_credito" | "cartao_debito" | null;
    readonly change_for_cents: number | null;
    readonly subtotal_cents: number;
    readonly delivery_fee_cents: number;
    readonly total_cents: number;
    readonly items: readonly {
      readonly name: string;
      readonly size_name: string | null;
      readonly unit_price_cents: number;
      readonly qty: number;
      readonly notes: string | null;
    }[];
  };
}

export interface ClaimedJob {
  readonly id: string;
  readonly attempts: number;
  readonly ticket: WireTicket;
}

export interface PrintJobApi {
  claim(limit: number): Promise<ClaimedJob[]>;
  report(id: string, result: { printed: true } | { printed: false; error: string }): Promise<void>;
}

export interface TicketPrinter {
  print(bytes: Uint8Array): Promise<void>;
}

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
