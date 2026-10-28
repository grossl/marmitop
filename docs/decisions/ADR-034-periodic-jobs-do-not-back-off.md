# ADR-034 — Periodic jobs do not back off

**Status:** accepted · 2026-10-28 · amends FR-108, FR-174

## Question

FR-108 retries a failed poll job at 1 minute, 5 minutes, 30 minutes, 2 hours, and 8 hours. The poll jobs are also periodic: pg_cron enqueues the timestamp poll (`whatsapp_reconcile`) every 30 seconds, and the worker timer enqueues the feed read (`uatis_feed_pull`) every few seconds. Both enqueue functions skip a restaurant that already has a job of that op in `mt_sync`, and a delayed retry counts as one.

On 2026-10-27 `backend-uatis` stopped for about 13 hours. The poll failed five times. The sixth try was due 8 hours later. When `backend-uatis` came back, no new poll was enqueued, because the delayed retry sat in the queue. Customer messages waited in `backend-uatis` until someone moved the job by hand. How should a periodic job handle a transient failure?

## Options

1. Keep the backoff and let the enqueue functions ignore delayed retries. Two jobs for one restaurant can then run at once, and the retry still runs hours later for no reason.
2. Cap the retry delay of poll jobs at the poll interval. It keeps a second schedule next to the real one, and every attempt still carries an attempt number that means nothing.
3. A periodic job does not retry. A transient failure writes its `job_attempts` row (`transient_error`) and archives the job. The next tick enqueues a fresh job.

## Tradeoffs

Option 3 tries again every tick while `backend-uatis` is down: every 30 seconds for the timestamp poll, every `MT_UATIS_PULL_SECONDS` for the feed read. Each try is one HTTP request and one `job_attempts` row; `mt_trim_job_attempts` removes old rows daily. The poll and the feed are safe to repeat: the cursor overlap and the `external_id` upsert (FR-104, FR-176) make a repeated read harmless.

A permanent failure (a refused key, a refused host) still sets the integration to `error`, and the enqueue functions stop at once, because they need `status = connected`.

## Recommendation and choice

Option 3.

* A job handler can declare `periodic: true`. For such a handler, the worker turns a transient failure into a `transient_error` attempt and archives the job: no re-send and no `onExhausted`. A permanent failure works as before.
* `whatsapp_reconcile` and `uatis_feed_pull` are periodic.
* FR-108's schedule stays for the jobs that are not periodic: outbound messages, invoice jobs, and outbound webhooks.

## Consequences

* After an outage, messages arrive within one tick of `backend-uatis` coming back.
* A long outage writes one attempt row per tick. That is the price of fast recovery, and the daily trim bounds it.
