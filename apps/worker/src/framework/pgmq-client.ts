// PgmqQueueClient: the QueueClient over pgmq (packages/db queue helpers).
// `complete` writes the `job_attempts` row, archives the message, and enqueues
// the retry in one transaction under the job's restaurant context (actor
// `system`), so RLS applies to the attempt row (05.data-model.md "job_attempts").

import {
  archiveJob,
  type ContextOptions,
  type Db,
  type QueueMessage,
  type QueueName,
  readJobs,
  sendJob,
  type Tx,
  withoutContext,
  withRestaurantContext,
} from "@mt/db";

import type { CompleteInput, QueueClient } from "./types";

export class PgmqQueueClient implements QueueClient {
  constructor(
    private readonly db: Db,
    private readonly contextOptions: ContextOptions = { role: "app_service" },
  ) {}

  read(queue: QueueName, visibilityTimeoutSeconds: number, qty: number): Promise<QueueMessage<unknown>[]> {
    return withoutContext(this.db, (tx) => readJobs<unknown>(tx, queue, visibilityTimeoutSeconds, qty), "app_service");
  }

  async complete(input: CompleteInput): Promise<void> {
    const work = async (tx: Tx) => {
      const a = input.attempt;
      if (a) {
        await tx`
          insert into public.job_attempts
            (restaurant_id, queue, msg_id, subject_type, subject_id, attempt_no, outcome, http_status, error_code, duration_ms)
          values (${a.restaurantId}, ${input.queue}, ${input.msgId}, ${a.subjectType}, ${a.subjectId}, ${a.attemptNo},
                  ${a.outcome}, ${a.httpStatus}, ${a.errorCode}, ${a.durationMs})
        `;
      }
      if (input.retry) await sendJob(tx, input.queue, input.retry.payload, input.retry.delaySeconds);
      await archiveJob(tx, input.queue, input.msgId);
    };
    if (input.attempt) {
      await withRestaurantContext(
        this.db,
        { restaurantId: input.attempt.restaurantId, actorType: "system" },
        work,
        this.contextOptions,
      );
    } else {
      await withoutContext(this.db, work, "app_service");
    }
  }
}
