# ADR-005 — Authentication, tenancy, and roles

**Status:** accepted · 2026-10-13

## Question

How do users log in, how is data isolated between restaurants, and how are the roles `admin` and `attendant` enforced?

## Options

1. Supabase Auth, a `restaurants` tenant table, and `restaurant_members(role)`, with RLS on every table.
2. Single-tenant deployment (one database per restaurant).

## Tradeoffs

The goal describes a SaaS, so multi-tenancy is required. Option 2 does not scale operationally.

## Recommendation and choice

Option 1, the same model as web-nf:

* Supabase Auth with email and password. A middleware redirects unauthenticated requests to `/login`.
* `restaurants` is the tenant. `restaurant_members(user_id, restaurant_id, role)` with `role in ('admin','attendant')`.
* Every tenant table has `restaurant_id` and RLS. SQL helpers: `mt.is_member(restaurant_id)` and `mt.is_admin(restaurant_id)`.
* Server processes connect as `app_service` (`nobypassrls`) and set `app.restaurant_id` per transaction, as in web-nf ADR-008.
* **attendant:** messages, orders, new order, contacts. **admin:** everything, including menu, stock, reports, and settings.
* Role checks run in two places: the service layer (authoritative) and the navigation (hides items).

## Consequences

* The v1 UI assumes one restaurant per user. The schema allows more.
* The seed creates one admin and one attendant per demo restaurant.
