// packages/db/src/queue.integration.test.ts
//
// covers FR-107, FR-108, NFR-022
//
// The four pgmq queues and the functions pg_cron drives (05.data-model.md
// "Queues (pgmq)", "pg_cron schedules"; ADR-007). The schedules themselves
// need pg_cron, which the test database lacks; the functions are called here
// directly.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { type Db, withoutContext, withUserSession } from "./client";
import { archiveJob, deleteJob, QUEUE_NAMES, QUEUES, queueMetrics, readJobs, sendJob, setJobVisibility } from "./queue";
import {
  asService,
  createTestDb,
  errorCode,
  INSUFFICIENT_PRIVILEGE,
  type RestaurantFixture,
  seedRestaurant,
  truncateAll,
  truncateQueues,
} from "./test-harness";

let db: Db;
let a: RestaurantFixture;
let b: RestaurantFixture;

beforeAll(async () => {
  db = await createTestDb();
  await truncateAll(db);
  a = await seedRestaurant(db, "Fila A");
  b = await seedRestaurant(db, "Fila B");
});

beforeEach(async () => {
  await truncateQueues(db);
});

afterAll(async () => {
  await db?.end({ timeout: 5 });
});

interface OutboundMessage {
  v: 1;
  restaurantId: string;
  messageId: string;
}

describe("queue helpers on app_service", () => {
  test("all four queues exist", async () => {
    const rows = await db<{ queue_name: string }[]>`select queue_name from pgmq.meta order by queue_name`;
    expect(rows.map((r) => r.queue_name)).toEqual([...QUEUE_NAMES].sort());
  });

  test("send, read, archive round trip keeps the message shape", async () => {
    const message: OutboundMessage = { v: 1, restaurantId: a.restaurantId, messageId: a.messageId };
    const msgId = await asService(db, a.attendantCtx, (tx) => sendJob(tx, QUEUES.outboundMessages, message));
    expect(typeof msgId).toBe("number");

    const read = await asService(db, a.systemCtx, (tx) =>
      readJobs<OutboundMessage>(tx, QUEUES.outboundMessages, 30, 5),
    );
    expect(read).toHaveLength(1);
    expect(read[0]?.message).toEqual(message);
    expect(read[0]?.readCount).toBe(1);

    // Invisible while in flight.
    const again = await asService(db, a.systemCtx, (tx) => readJobs(tx, QUEUES.outboundMessages, 30));
    expect(again).toHaveLength(0);

    expect(await asService(db, a.systemCtx, (tx) => archiveJob(tx, QUEUES.outboundMessages, msgId))).toBe(true);
    const [archived] = await db<{ n: number }[]>`select count(*)::int as n from pgmq.a_mt_outbound_messages`;
    expect(archived?.n).toBe(1);
    expect(await asService(db, a.systemCtx, (tx) => archiveJob(tx, QUEUES.outboundMessages, msgId))).toBe(false);
  });

  test("a message enqueued in a rolled-back transaction never appears", async () => {
    await errorCode(() =>
      asService(db, a.attendantCtx, async (tx) => {
        await sendJob(tx, QUEUES.webhookDeliveries, {
          v: 1,
          restaurantId: a.restaurantId,
          deliveryId: a.webhookDeliveryId,
        });
        throw new Error("rollback");
      }),
    );
    const metrics = await asService(db, a.systemCtx, (tx) => queueMetrics(tx, QUEUES.webhookDeliveries));
    expect(metrics.queueLength).toBe(0);
  });

  test("a delayed message is invisible until its delay passes; visibility can be reset", async () => {
    const msgId = await asService(db, a.systemCtx, (tx) =>
      sendJob(
        tx,
        QUEUES.invoiceJobs,
        { v: 1, restaurantId: a.restaurantId, orderInvoiceId: a.orderInvoiceId, op: "issue" },
        60,
      ),
    );
    expect(await asService(db, a.systemCtx, (tx) => readJobs(tx, QUEUES.invoiceJobs, 30))).toHaveLength(0);
    await asService(db, a.systemCtx, (tx) => setJobVisibility(tx, QUEUES.invoiceJobs, msgId, 0));
    const read = await asService(db, a.systemCtx, (tx) => readJobs(tx, QUEUES.invoiceJobs, 30));
    expect(read.map((m) => m.msgId)).toEqual([msgId]);
    expect(await asService(db, a.systemCtx, (tx) => deleteJob(tx, QUEUES.invoiceJobs, msgId))).toBe(true);
  });

  test("an unknown queue name is refused before it reaches SQL", async () => {
    await expect(asService(db, a.systemCtx, (tx) => sendJob(tx, "nope" as never, {}))).rejects.toThrow("unknown queue");
  });

  test("app_service cannot drop or purge a queue", async () => {
    for (const statement of ["select pgmq.drop_queue('mt_sync')", "select pgmq.purge_queue('mt_sync')"]) {
      const code = await errorCode(() => withoutContext(db, (tx) => tx.unsafe(statement)));
      expect(code).not.toBeNull();
    }
    const rows = await db<{ queue_name: string }[]>`select queue_name from pgmq.meta where queue_name = 'mt_sync'`;
    expect(rows).toHaveLength(1);
  });

  test("the browser role cannot touch the queues", async () => {
    const code = await errorCode(() =>
      withUserSession(db, a.adminId, (tx) => tx`select pgmq.send('mt_sync', '{}'::jsonb)`),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("scheduled functions", () => {
  test("mt.enqueue_whatsapp_sync enqueues one message per connected restaurant, and not twice", async () => {
    await db`update public.integrations_whatsapp set status = 'disconnected' where restaurant_id = ${b.restaurantId}`;
    const [first] = await db<{ n: number }[]>`select mt.enqueue_whatsapp_sync() as n`;
    const [second] = await db<{ n: number }[]>`select mt.enqueue_whatsapp_sync() as n`;
    expect([first?.n, second?.n]).toEqual([1, 0]);
    const rows = await db<{ message: Record<string, unknown> }[]>`select message from pgmq.q_mt_sync`;
    expect(rows.map((r) => r.message)).toEqual([{ v: 1, restaurantId: a.restaurantId, op: "whatsapp_reconcile" }]);
    await db`update public.integrations_whatsapp set status = 'connected' where restaurant_id = ${b.restaurantId}`;
  });

  test("mt.enqueue_invoice_polls enqueues invoices in flight for over a minute", async () => {
    // set_updated_at would overwrite a backdated updated_at, so it is paused for this one update.
    await db.begin(async (tx) => {
      await tx`alter table public.order_invoices disable trigger order_invoices_set_updated_at`;
      await tx`update public.order_invoices set status = 'processing', updated_at = now() - interval '2 minutes' where id = ${a.orderInvoiceId}`;
      await tx`alter table public.order_invoices enable trigger order_invoices_set_updated_at`;
    });
    const [first] = await db<{ n: number }[]>`select mt.enqueue_invoice_polls() as n`;
    const [second] = await db<{ n: number }[]>`select mt.enqueue_invoice_polls() as n`;
    expect([first?.n, second?.n]).toEqual([1, 0]);
    const rows = await db<{ message: Record<string, unknown> }[]>`select message from pgmq.q_mt_invoice_jobs`;
    expect(rows[0]?.message).toEqual({
      v: 1,
      restaurantId: a.restaurantId,
      orderInvoiceId: a.orderInvoiceId,
      op: "poll",
    });
  });

  test("mt.requeue_due_deliveries re-enqueues due deliveries only", async () => {
    await db`update public.webhook_deliveries set status = 'failed', next_attempt_at = now() - interval '1 minute' where id = ${a.webhookDeliveryId}`;
    await db`update public.webhook_deliveries set status = 'failed', next_attempt_at = now() + interval '1 hour' where id = ${b.webhookDeliveryId}`;
    const [row] = await db<{ n: number }[]>`select mt.requeue_due_deliveries() as n`;
    expect(row?.n).toBe(1);
    const rows = await db<{ message: Record<string, unknown> }[]>`select message from pgmq.q_mt_webhook_deliveries`;
    expect(rows[0]?.message).toEqual({ v: 1, restaurantId: a.restaurantId, deliveryId: a.webhookDeliveryId });
  });

  test("mt.reap_stuck_messages fails outbound messages pending for 10 minutes, without resending", async () => {
    const [stuck] = await db<{ id: string }[]>`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status, created_at)
      values (${a.restaurantId}, ${a.conversationId}, 'out', 'Olá', 'pending', now() - interval '11 minutes')
      returning id`;
    const [fresh] = await db<{ id: string }[]>`
      insert into public.messages (restaurant_id, conversation_id, direction, body, status)
      values (${a.restaurantId}, ${a.conversationId}, 'out', 'Olá', 'pending') returning id`;
    const [row] = await db<{ n: number }[]>`select mt.reap_stuck_messages() as n`;
    expect(row?.n).toBe(1);
    const statuses = await db<{ id: string; status: string; error_code: string | null }[]>`
      select id, status, error_code from public.messages where id in (${stuck?.id ?? ""}, ${fresh?.id ?? ""})`;
    expect(statuses.find((s) => s.id === stuck?.id)).toMatchObject({ status: "failed", error_code: "stuck" });
    expect(statuses.find((s) => s.id === fresh?.id)).toMatchObject({ status: "pending" });
    const metrics = await asService(db, a.systemCtx, (tx) => queueMetrics(tx, QUEUES.outboundMessages));
    expect(metrics.queueLength).toBe(0);
  });

  test("the trim functions delete only rows past their retention window", async () => {
    await db`insert into public.job_attempts (restaurant_id, queue, subject_type, attempt_no, outcome, created_at)
             values (${a.restaurantId}, 'mt_sync', 'sync', 1, 'ok', now() - interval '31 days')`;
    await db`insert into public.idempotency_records (restaurant_id, idempotency_key, request_hash, response_status, response_body, created_at)
             values (${a.restaurantId}, 'old-key', 'h', 201, '{}'::jsonb, now() - interval '31 days')`;
    await db`insert into public.audit_logs (restaurant_id, actor_type, action, entity_type, created_at)
             values (${a.restaurantId}, 'system', 'old.entry', 'x', now() - interval '366 days')`;
    await db`insert into public.rate_counters (subject_id, class, window_start, count)
             values (${a.apiKeyId}, 'read', now() - interval '2 hours', 3), (${a.apiKeyId}, 'read', date_trunc('minute', now()), 1)`;
    const [counts] = await db<Record<string, number>[]>`
      select mt.trim_job_attempts() as attempts, mt.trim_idempotency() as idempotency,
             mt.trim_audit_logs() as audit, mt.trim_rate_counters() as rate,
             mt.trim_webhook_deliveries() as deliveries, mt.trim_queue_archives() as archives`;
    expect(counts).toEqual({ attempts: 1, idempotency: 1, audit: 1, rate: 1, deliveries: 0, archives: 0 });
  });

  test("app_service cannot call the scheduled functions", async () => {
    const code = await errorCode(() => withoutContext(db, (tx) => tx`select mt.enqueue_whatsapp_sync()`));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
