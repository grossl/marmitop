# ADR-038 — Order tickets print on a local thermal printer

**Status:** accepted · 2026-10-30

## Question

The kitchen wants a paper ticket for each order. The restaurant's printer is an 80 mm ESC/POS thermal printer (Elgin i8) on USB, connected to the counter computer. The API and the worker run on a server that cannot reach that USB port. What prints the ticket, and when?

## Options

1. **The browser prints.** The dashboard opens a ticket page and calls `window.print()`. The printer has no macOS driver, so CUPS sends raw bytes only and cannot render HTML. A person must also keep the dashboard open and accept each print dialog. Kiosk printing removes the dialog only in Chrome with a special start flag.
2. **WebUSB from the dashboard.** The dashboard writes ESC/POS bytes to the USB device. macOS gives the printer interface to its own USB printer driver, so the browser cannot claim it. Safari has no WebUSB.
3. **A local print agent pulls jobs.** A small Bun process, `apps/print-agent`, runs on the counter computer. It reads print jobs from the public API with a restaurant API key, renders ESC/POS bytes, and sends them to the CUPS queue with `lp -o raw`. It reports each result back to the API.
4. **The server pushes to the agent.** The same agent, but the server calls it. The counter computer is behind NAT, so this needs a tunnel. ADR-023 refused a tunnel for the same reason.

## Tradeoffs

Option 3 works with the driverless raw queue, with no open browser, and with no inbound port. The agent is one more process for the restaurant to run, so 11.operations.md explains how to start it at login. Option 4 adds a tunnel and saves only the poll interval. Options 1 and 2 do not work with this printer on macOS.

Jobs need a lease, retries, and a state that the dashboard can show. pgmq (ADR-007) is for the worker, which reads the queue directly. Here the reader is a remote process on HTTP, so a `print_jobs` table with a claim lease is simpler and does not expose pgmq.

## Choice

Option 3.

* **When a job is created.** A restaurant with `restaurant_settings.auto_print_orders` on gets one `order_ticket` job per order. The job is created in the same transaction as the event that accepts the order: the order is created with a status other than `aguardando`, or the order moves from `aguardando` to a status other than `cancelado`. A unique key on `(restaurant_id, order_id, kind)` makes this happen once per order. An order that waits as `aguardando` and is then cancelled prints nothing. The switch is off by default.
* **The table.** `public.print_jobs` has `status` `pending`, `printing`, `printed`, or `failed`, plus `attempts`, `last_error`, `claimed_at`, and `printed_at`. RLS isolates it by `restaurant_id`, like every tenant table.
* **The API.** `POST /v1/print-jobs/claim` gives the agent up to 10 jobs. Each job is `pending`, or `printing` with a lease older than 2 minutes. The claim sets `printing`, adds 1 to `attempts`, and returns each job with the ticket data: the order, the customer's name and phone, and the restaurant's name. `POST /v1/print-jobs/{id}/result` with `printed: true` sets `printed`. With `printed: false`, the job goes back to `pending`. After 5 attempts it becomes `failed`. A result for a job that is not `printing` is `409 conflict`.
* **The ticket.** `packages/core` renders the ticket as text lines for a given width (48 columns for 80 mm) and encodes the lines as ESC/POS bytes in code page 860, so Portuguese letters print correctly. Both functions are pure and have unit tests.
* **No second copy.** A ticket that printed, but whose result did not reach the API, comes back after the lease. The agent writes each printed job id to a local file before it posts the result, and tries the post 3 times. When a job in that file comes back, the agent posts `printed: true` and does not print it again.
* **The agent.** `apps/print-agent` polls every 3 seconds. The API client and the printer are injectable ports. The production printer runs `lp -d <queue> -o raw`. The agent reads `MT_API_URL`, `MT_API_KEY`, and `MT_PRINTER` from its environment and never logs the key.
* **Setup.** The printer gets a driverless CUPS queue: `lpadmin -p Elgin_i8 -E -v 'usb://Printer/POS-80?location=…'`. macOS refuses `-m raw`, but a queue with no driver is a "Local Raw Printer" and accepts `lp -o raw`.

## Consequences

* New FR-250 to FR-254 and NFR-064. Migration 0030 adds `print_jobs` and `restaurant_settings.auto_print_orders`.
* 05.data-model.md, 06.api-spec.md, 06.openapi.yaml, and 11.operations.md change.
* Configurações → Pedidos gets the switch "Imprimir comanda automaticamente".
* A reprint button on the order is not part of this ADR. The table allows it later as a second `kind`.
