# ADR-003 — Invoices through web-nf

**Status:** accepted · 2026-10-13

## Question

The goal says an order must generate an invoice through the local `web-nf` project, and the dashboard must send it, check the result, and show the XML and PDF. Which invoice kind, and how do the two systems talk?

## Options

1. **NFC-e** (`kind: "nfce"`, model 65). Consumer sale of goods. This is the usual document for restaurants and delivery.
2. **NFe** (`kind: "nfe"`, model 55). Sale of goods to a business, with full recipient data.
3. **NFSe.** Prepared meals are goods taxed by ICMS, not services taxed by ISS, so NFSe does not fit.

## Tradeoffs

NFC-e matches a sale to a final consumer, and the recipient is optional. web-nf requires a CSC for NFC-e, and the restaurant configures it in web-nf. NFe is needed when the customer is a company that asks for one. Supporting both costs one extra mapping, because web-nf uses the same item shape for both.

## Recommendation and choice

NFC-e by default. NFe is used when the order's customer has a CNPJ and the attendant selects "NF-e".

* A port `InvoiceGateway` in `packages/core` has two adapters: `WebNfGateway` and `FakeInvoiceGateway`.
* Each restaurant stores its `web-nf` base URL, API key (`nfk_test_`/`nfk_live_`, encrypted per ADR-012), webhook secret, series, and fiscal defaults (NCM, CFOP, CSOSN/CST, PIS/COFINS CST).
* Menu items and drinks can override NCM and CFOP.
* **Issue:** the attendant clicks "Emitir NF" on an order. A row is created in `order_invoices` and a job is queued. The worker calls `POST /v1/invoices` with `Idempotency-Key = order_invoices.id`. `operacao.presenca` is `entrega_domicilio` for delivery and `presencial` for pickup.
* **Result:** `apps/api` exposes `POST /v1/webhooks/web-nf/{restaurant_id}`. It verifies `X-NF-Signature` (the same `t=,v1=` scheme, with a 5-minute tolerance). A poll job (`GET /v1/invoices/{id}`) runs while the invoice is not final.
* **XML and PDF:** web-nf returns short-lived signed URLs. The dashboard calls `GET /v1/invoices/{id}` when the user opens the invoice panel, and it never stores the URLs.
* **Cancel:** `POST /v1/invoices/{id}/events` with `type: "cancelamento"`.

## Consequences

* An invoice can be issued only for an order that is `entregue` or `pronto`/`saiu` and not `cancelado`.
* Invoice states mirror web-nf: `queued`, `processing`, `authorized`, `rejected`, `denied`, `failed`, `cancelled`.
* NFSe is out of scope for orders. Domain research (03) still describes it, as the goal requires.
