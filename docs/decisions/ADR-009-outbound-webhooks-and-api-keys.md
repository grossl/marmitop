# ADR-009 — Outbound webhooks and API keys

**Status:** accepted · 2026-10-13

## Question

Settings has an outbound webhook URL and an API key. What do they do?

## Choice

* **API keys** authenticate integrators against `apps/api`. Format: `mtk_live_<base62>` or `mtk_test_<base62>`. Only the SHA-256 hash and a display prefix are stored. The full key is shown once.
* **Outbound webhook:** one URL per restaurant in v1. Events: `order.created`, `order.status_changed`, `message.received`, `invoice.updated`. Header `X-Marmitop-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`, plus `X-Marmitop-Event` and `X-Marmitop-Delivery`. This is the same scheme as web-nf and backend-uatis, so all three systems verify one way.
* The worker delivers with a 10-second timeout and no redirects. Retries follow ADR-007. An SSRF guard blocks private, loopback, and link-local hosts in production.
