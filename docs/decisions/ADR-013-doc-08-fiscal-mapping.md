# ADR-013 — Doc 08 becomes the fiscal mapping

**Status:** accepted · 2026-10-13

## Question

The goal lists `08.validation-templates.md` as "the municipality template system (see Backoffice below)". That line was copied from `web-nf`, where a backoffice manages one validation template per municipality for NFSe. Marmitop has no backoffice, no NFSe, and no municipality templates (ADR-003). What does document 08 contain instead?

## Options

1. **Keep the file name and write a short "not applicable" note.** This follows the goal to the letter and leaves a gap: nothing documents how an order becomes a `web-nf` request.
2. **Drop document 08 and renumber 09 to 11.** This avoids a dead file but breaks the numbering that the goal and the other documents already cite.
3. **Replace the content and rename the file `08.fiscal-mapping.md`.** The number stays. The file covers the part of the fiscal flow that Marmitop owns.

## Tradeoffs

Option 1 keeps the goal's file name and wastes a document slot. Option 2 changes every reference to 09, 10, and 11. Option 3 changes one name and fills the slot with the content a developer needs most: the field-by-field mapping, the checks before sending, and the error messages. The cost is a deviation from the goal's file name, which this ADR records.

## Recommendation and choice

Option 3.

`docs/08.fiscal-mapping.md` replaces `08.validation-templates.md`. It defines:

* how an order, its items, the menu fiscal fields, the customer, and the restaurant's fiscal defaults map to the `POST /v1/invoices` payload for `nfce` and `nfe`;
* the validation rules Marmitop runs before it sends (V1 to V14);
* idempotency and retry rules, with `order_invoices.id` as the `Idempotency-Key` and a frozen request payload;
* the table from `web-nf` error codes and SEFAZ rejection codes to pt-BR messages in the UI.

Choices made inside 08 that need a record here:

* **Delivery fee as an extra invoice item** (`ENTREGA`, "Taxa de entrega"), because `web-nf` rejects freight values on NFC-e and the payments must equal the item total. An accountant must confirm. A setting `delivery_fee_mode` allows `none`.
* **Simples Nacional only in v1.** CSOSN comes from the restaurant default, and from `500` when the CFOP is `5405`.
* **Data model changes proposed for 05:** structured customer and order address fields (IBGE code, UF, CEP), `order_invoices.request_payload`, `integrations_fiscal.delivery_fee_mode`.

## Consequences

* `docs/08.validation-templates.md` is never created. The numbering 09, 10, 11 stays.
* Document 05 must add the proposed columns before the migration is written. Document 02 must carry a requirement for the pre-send checks (FR-120 range).
* `packages/core` gets a pure `buildInvoiceRequest` function and a `centsToReais` helper, both unit-tested.
* Five open questions (Q1 to Q5 in 08) stay open until the product owner, an accountant, and the `web-nf` owner answer them. None of them blocks v1 with the stated defaults.
* A later NFSe product would need a new document. This ADR does not block that.
