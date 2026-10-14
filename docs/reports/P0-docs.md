# P0 — Documents: consistency pass

## What was done

* Aligned docs 02 to 11 with ADR-013 to ADR-017. The newest ADR wins on conflict.
* 08: address gap G1 follows ADR-016 (structured columns, no CEP lookup). G4, G5, and G6 are marked resolved. Column names are `default_pis_cst` and `default_cofins_cst`.
* 06 and `06.openapi.yaml`: ADR-016 address fields on orders and customers; API key lookup by unique hash; `orders.source` has `api`; test and live keys behave the same; the send-message endpoint returns `422 outside_service_window` outside the 24-hour window and documents the no-retry rule for ambiguous sends.
* 05: status matrix follows ADR-017 (forward skips, one step back, no `saiu` for pickup, final states); `source` check includes `api`; send retry semantics.
* 07: `MT_ALLOW_PRIVATE_HOSTS=1` and the production start-up refusal; `authenticated` has no write grant, with the `menu-images` upload exception.
* 02: FR-020 to FR-029 follow ADR-017. FR-034 now covers the structured address. FR-117 is the service window requirement. FR-125 covers the invoice pre-check and frozen payload. FR-111 cites ADR-015. FR-120 and FR-132 allow the attendant.
* 04, 09, 10, 11: references updated. One canonical environment variable list sits in 04 "Configuration". 06, 07, and 11 use the same names.
* 10: every FR and NFR it cites now exists in 02 with the same meaning. The DoD table holds the canonical planned test paths.
* Added `docs/decisions/README.md`, an index of ADR-001 to ADR-017.

## What was verified

* A script checked that every FR and NFR id cited in any doc exists in 02, and that every ADR number cited is between 001 and 017.
* A text search of all docs found no stale `neighborhood`, free-text `address` columns, `generation-api`, `08.validation-templates`, "pending ADR", or "proposed ADR" outside the allowed notes. "MarmitaChat" remains only in 01 (describes the prototype), FR-099 (absence rule), and ADR-001.
* Not verified: no code or migration exists yet, so none of this ran against a database or a service.

## Remaining risks

* `backend-uatis` does not deliver customer webhooks yet. The 30-second reconciliation poll is the only working inbound path (ADR-002 Amendment 1).
* `backend-uatis` `POST /v1/messages` has no idempotency key. After a timeout the worker does not retry, so a message may be lost or doubled by hand resend (ADR-017).
* Restaurant NCM, CFOP, and CST defaults in 08 are unverified until an accountant confirms them. The delivery fee as an invoice item also needs that review.
* NFC-e delivery needs the customer's CPF or CNPJ and a full address. Without them "Emitir NF" stops (ADR-016).
* GitHub push authentication is failing, so nothing from this pass is pushed. Nothing was committed.
