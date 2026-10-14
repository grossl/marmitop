# ADR-018 — Tenant composite foreign keys, no deletes, and API key use

**Status:** accepted · 2026-10-13

## Question

The P2 review found three gaps in the data model.

1. A foreign key such as `orders.customer_id → customers(id)` checks that the parent exists. It does not check that the parent belongs to the same restaurant. RLS checks the child row's own `restaurant_id`, and a foreign key check bypasses RLS. So a service bug could link restaurant A's order to restaurant B's customer, and later joins would show B's data inside A.
2. 05 let attendants delete orders, messages, and conversations. Realtime does not apply RLS to `DELETE` events, and v1 has no screen that deletes these rows.
3. An API key acts as an attendant (ADR-017), and `api_keys` writes are admin-only. So `apps/api` cannot record `last_used_at`.

## Options

For 1:

* **Composite foreign key.** Each parent gets `unique (restaurant_id, id)`. Each child key becomes `(restaurant_id, parent_id) → parent (restaurant_id, id)`.
* **Trigger check.** A trigger on each child looks up the parent's restaurant.
* **Service only.** The service layer checks ownership before it writes.

For 2: keep the deletes; revoke them; or replace them with soft delete where a screen needs "delete".

For 3: a `system` context for the update; a definer function that writes only `last_used_at`; or drop the column.

## Tradeoffs

* Composite keys are declarative. Postgres enforces them on every path, including a forgotten service check and a DBA script. They cost one extra unique index per parent and one extra column per key. `on delete set null` needs a column list (`set null (customer_id)`), which Postgres 15 and later support.
* A trigger per child is more code to test and is easy to forget on a new table.
* A service-only check is the layer that already failed in this scenario.
* Revoking deletes removes the Realtime `DELETE` gap and keeps order history and fiscal records whole. "Delete" in the menu (FR-057) and on stock items becomes an archive flag. Customers are never deleted in v1.
* A system context for one column would give the API request admin rights for that statement. A narrow definer function grants exactly one write.

## Recommendation and choice

1. **Composite foreign keys** on every child-to-parent key between tenant tables. A meta-test fails when a new key between tenant tables lacks `restaurant_id`. The secret-kind trigger stays for the `kind` check.
2. **No deletes** on `orders`, `order_items`, `order_status_history`, `order_invoices`, `messages`, `conversations`, `customers`, `menu_items`, `stock_items`, `stock_movements`, `audit_logs`, `usage_events`, and `job_attempts` for any role. `menu_items` and `stock_items` get `archived_at`; archived rows leave lists and new orders, and order items keep their snapshot. `menu_item_sizes` keeps its admin delete, because sizes are edited with the item and no row references a size. No v1 service edits order items after creation, so none needs a delete.
3. **`mt.touch_api_key(key_id)`**, `security definer`, granted to `app_service`. It sets `last_used_at = now()` for a key of the current restaurant, only when the stored value is null or older than 60 seconds.

## Consequences

* Migrations 0004 to 0011 were edited in place. No environment had applied them.
* The retention trims (`mt.trim_*`) still delete, as definer functions, outside the grant model.
* Deleting a restaurant (DBA only) still cascades to every row.
