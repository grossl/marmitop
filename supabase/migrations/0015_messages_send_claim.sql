-- 0015_messages_send_claim.sql
--
-- Two columns the P5 WhatsApp send path needs (05.data-model.md "messages";
-- ADR-014, ADR-017 #4).
--
-- * template_language: the language of the approved template a message went
--   out as. Set together with template_name (ADR-014). The worker sends the
--   template with this language.
-- * send_claimed_at: set by the mt_outbound_messages consumer in its own
--   committed transaction right before POST /v1/messages. A message that is
--   already claimed is never sent again by the worker: backend-uatis takes no
--   idempotency key, so the send is at-most-once (ADR-017 #4). A connection
--   error before the request left clears the claim with the retry. A manual
--   retry (FR-019) clears it too.

alter table public.messages add column if not exists template_language text;
alter table public.messages add column if not exists send_claimed_at timestamptz;

alter table public.messages drop constraint if exists messages_template_pair;
alter table public.messages add constraint messages_template_pair
  check ((template_name is null) = (template_language is null));
