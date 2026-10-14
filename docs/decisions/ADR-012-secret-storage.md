# ADR-012 — Secret storage

**Status:** accepted · 2026-10-13

## Question

Marmitop stores third-party credentials per restaurant: the `backend-uatis` API key and webhook secret, the `web-nf` API key and webhook secret, and the restaurant's own outbound webhook secret. How are they protected?

## Choice

Envelope encryption, as in web-nf ADR-005. Each secret is encrypted with AES-256-GCM under a random data key. The data key is wrapped with the key-encryption key `MT_KEK` (32 bytes, base64, from the environment). Table `secrets(id, restaurant_id, kind, ciphertext, iv, wrapped_key, created_at)`. Plaintext exists only in memory inside `apps/api`, `apps/worker`, and the dashboard server. Secrets are never logged and never returned to the browser. The UI shows only a "configured" state and the last four characters.
