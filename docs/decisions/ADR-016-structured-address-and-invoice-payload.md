# ADR-016 — Structured addresses and frozen invoice payloads

**Status:** accepted · 2026-10-13

## Question

08.fiscal-mapping.md found three facts in `web-nf` that the data model does not support:

1. An NFC-e with `presenca: entrega_domicilio` needs an identified recipient (CPF or CNPJ) and a full address: `logradouro`, `numero`, `bairro`, an 8-digit `cep`, `uf`, and the IBGE `codigo_municipio`. Marmitop stores a free-text address.
2. `web-nf` does not accept a freight value on NFC-e. The delivery fee has no field to go in.
3. The `Idempotency-Key` is bound to the body. A retry with a different body returns `409 idempotency_conflict`.

## Options

For addresses: (a) keep free text and invoice delivery orders as `presencial`; (b) store structured addresses and require them only when an invoice is issued for a delivery order.

For the delivery fee: (a) leave it out of the invoice; (b) send it as an extra item "Taxa de entrega"; (c) make it a restaurant setting.

## Tradeoffs

Option (a) for addresses misstates how the sale happened, which is a fiscal risk. Option (b) costs a few more form fields but keeps order entry fast, because the fields are needed only for an invoice. How to invoice the delivery fee is an accounting question, so the restaurant chooses it.

## Recommendation and choice

* `customers` and `orders` store a structured address: `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `codigo_municipio`. The old `address` and `neighborhood` become those fields. `bairro` replaces `neighborhood`. The UI shows one line built from the parts.
* `restaurants` stores its own `cidade`, `uf`, and `codigo_municipio`. New addresses default to the restaurant's city, so the attendant usually types only street, number, and neighborhood.
* `cpf_cnpj` stays optional on the customer. "Emitir NF" for a delivery order checks for CPF/CNPJ and the full address first. If something is missing, it opens a short form to fill the gaps. It never sends an incomplete request.
* `integrations_fiscal.delivery_fee_mode` (`item` | `none`, default `item`). With `item`, the fee becomes a line "Taxa de entrega" with the restaurant's default NCM and CFOP. An accountant should confirm the choice (08, Q2).
* `order_invoices.request_payload jsonb` stores the exact body sent the first time. Retries resend it unchanged.
* NFC-e cancellation shows a warning that SEFAZ allows it only within a short window (commonly 30 minutes).

## Consequences

* The New order and Contacts forms gain CEP and number fields. The full address prints on one line elsewhere.
* No CEP lookup service in v1. This is a possible follow-up.
