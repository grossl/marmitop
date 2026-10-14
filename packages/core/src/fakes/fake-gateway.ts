// FakeGateway: in-memory WhatsAppGateway (FR-100, FR-116). Production-quality code, not a test
// helper: the dev-only "Simulate customer message" control drives `simulateInbound`.
// It records calls and lets a test script the next response, failure, or delay.

import { normalizePhoneE164 } from "../br-documents";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import { GatewayError } from "../ports/gateway-error";
import type {
  ApprovedTemplate,
  ConnectionCheck,
  ListMessagesInput,
  ListMessagesResult,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  WhatsAppGateway,
} from "../ports/whatsapp-gateway";
import type { GatewayMessage, MessageStatus } from "../uatis-mapping";

export interface ScriptedSend {
  /** Override fields of the default `{ externalId: fake-msg-N, status: 'pending' }` answer. */
  readonly result?: Partial<SendResult>;
  /** Throw instead of answering. */
  readonly error?: Error;
  /** Wait before answering or throwing. */
  readonly delayMs?: number;
}

export type RecordedCall =
  | { readonly method: "sendText"; readonly input: SendTextInput }
  | { readonly method: "sendTemplate"; readonly input: SendTemplateInput }
  | { readonly method: "listMessages"; readonly input: ListMessagesInput }
  | { readonly method: "listApprovedTemplates" }
  | { readonly method: "testConnection" };

export interface SimulateInbound {
  /** Customer phone, any format `normalizePhoneE164` accepts. */
  readonly from: string;
  readonly body: string;
  readonly at?: Date;
  readonly conversationId?: string;
}

export class FakeGateway implements WhatsAppGateway {
  readonly calls: RecordedCall[] = [];
  readonly sentTexts: SendTextInput[] = [];
  readonly sentTemplates: SendTemplateInput[] = [];
  templates: ApprovedTemplate[] = [];

  private readonly clock: Clock;
  private readonly messages: GatewayMessage[] = [];
  private readonly scripted: ScriptedSend[] = [];
  private connection: ConnectionCheck = { ok: true };
  private nextId = 1;

  constructor(options: { clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock;
  }

  /** Queue the answer for the next send (text or template). Queued answers are used in order. */
  scriptNextSend(script: ScriptedSend): this {
    this.scripted.push(script);
    return this;
  }

  failNextSend(error: Error): this {
    return this.scriptNextSend({ error });
  }

  setConnection(check: ConnectionCheck): this {
    this.connection = check;
    return this;
  }

  /** Add an inbound message as backend-uatis would store it (status `delivered`). */
  simulateInbound(input: SimulateInbound): GatewayMessage {
    const address = normalizePhoneE164(input.from) ?? input.from;
    const message: GatewayMessage = {
      externalId: `fake-in-${this.nextId++}`,
      conversationExternalId: input.conversationId ?? `fake-conv-${address}`,
      direction: "in",
      body: input.body,
      contentType: "text",
      status: "delivered",
      contactAddress: address,
      createdAt: input.at ?? this.clock.now(),
    };
    this.messages.push(message);
    return message;
  }

  /** Move a stored message to a new status, as a `message.updated` event would. */
  setMessageStatus(externalId: string, status: MessageStatus): void {
    const i = this.messages.findIndex((m) => m.externalId === externalId);
    const m = this.messages[i];
    if (m) this.messages[i] = { ...m, status };
  }

  private async nextScript(): Promise<ScriptedSend | undefined> {
    const script = this.scripted.shift();
    if (script?.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
    return script;
  }

  private async send(
    to: string,
    body: string,
    record: () => void,
    contentType: GatewayMessage["contentType"],
  ): Promise<SendResult> {
    const script = await this.nextScript();
    if (script?.error) throw script.error;
    record();
    const result: SendResult = {
      externalId: script?.result?.externalId ?? `fake-msg-${this.nextId++}`,
      status: script?.result?.status ?? "pending",
    };
    this.messages.push({
      externalId: result.externalId,
      conversationExternalId: `fake-conv-${to}`,
      direction: "out",
      body,
      contentType,
      status: result.status,
      contactAddress: to,
      createdAt: this.clock.now(),
    });
    return result;
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    this.calls.push({ method: "sendText", input });
    return this.send(input.to, input.body, () => this.sentTexts.push(input), "text");
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    this.calls.push({ method: "sendTemplate", input });
    return this.send(input.to, `[template:${input.templateName}]`, () => this.sentTemplates.push(input), "text");
  }

  async listMessages(input: ListMessagesInput = {}): Promise<ListMessagesResult> {
    this.calls.push({ method: "listMessages", input });
    const from = input.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const matching = this.messages
      .filter((m) => m.createdAt.getTime() >= from && (!input.direction || m.direction === input.direction))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.externalId.localeCompare(b.externalId));
    const offset = input.cursor ? Number(input.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw GatewayError.http(422, "validation_failed", "bad cursor");
    const limit = Math.max(1, input.limit ?? 50);
    const items = matching.slice(offset, offset + limit);
    const next = offset + limit;
    return { items, nextCursor: next < matching.length ? String(next) : null };
  }

  async listApprovedTemplates(): Promise<readonly ApprovedTemplate[]> {
    this.calls.push({ method: "listApprovedTemplates" });
    return this.templates;
  }

  async testConnection(): Promise<ConnectionCheck> {
    this.calls.push({ method: "testConnection" });
    return this.connection;
  }
}
