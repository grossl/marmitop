# ADR-008 — Billing behind an interface

**Status:** accepted · 2026-10-13

## Choice

There is no payment provider in v1. A port `BillingProvider` (`getPlan`, `listInvoices`, `recordUsage`) has one adapter, `NullBillingProvider`. Usage events (`order.created`, `message.sent`, `invoice.issued`) are written to `usage_events`. Settings → Plano shows the plan, the usage for the current month, and an empty invoice history. A provider can be added later without a change to the callers.
