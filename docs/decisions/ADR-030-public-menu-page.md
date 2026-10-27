# ADR-030 — Public menu page

**Status:** accepted · 2026-10-27

## Question

The owner wants a page where a customer can see the restaurant menu without an account. The customer opens it from a link, for example one the restaurant sends on WhatsApp. How does the customer reach the page, and how does the page read the menu without a session and without breaking tenant isolation?

## Options

**Address.**

1. The restaurant id in the path: `/m/{restaurant_id}`. Nothing new to store or edit.
2. A slug the admin chooses: `/m/{slug}`. A nicer link, but it needs a unique column, an editor in Configurações, and rules for renames.
3. An external id: `restaurants.public_id`, a random 12-character value the database sets once and never changes. The link is `/m/{public_id}`.

**Data access.**

1. The page reads `menu_items` with a system context. The page gets a full tenant context only because it knows an id from the URL.
2. A `security definer` function `mt.public_menu(p_public_id)` returns only the public columns. The page calls it without a context, as `app_service`, like `mt.api_key_lookup`.
3. An `anon` RLS policy on `menu_items`. The fiscal columns (`ncm`, `cfop`) and archived items become readable by anyone through PostgREST.

**Switch.**

1. The page is always on.
2. An admin switch in Configurações, default off.

## Tradeoffs

A restaurant id is a random UUID, but it is the internal key of every tenant row, the RLS context, and the storage paths. A public link would spread it outside the product, and a future change to the address would break every shared link. An external id separates the two: the public link names the restaurant without the internal key. It is random, so a stranger cannot list the restaurants. A slug is easier to read, but the link is shared as a tap target, not typed. A slug can come later as a second address.

A system context gives the page every table of the restaurant. A definer function gives it one fixed result with chosen columns. An `anon` policy exposes more columns than the page needs and puts a second door on a tenant table.

A menu is meant to be public. A switch adds a setting and a step before the owner can share the link.

## Recommendation and choice

Address option 3, data access option 2, switch option 1. The owner asked for an external id.

* `restaurants.public_id` is `text not null unique`, 12 lowercase hex characters, set by a default on insert. A trigger refuses a change. Existing restaurants get a value in the migration (FR-225).
* `GET /m/{public_id}` is a public dashboard route. The proxy lets `/m/` paths through without a session (FR-220).
* `mt.public_menu(text)` takes the `public_id` and returns `null` for an unknown one. Otherwise it returns one `jsonb` value: the restaurant name and phone, the timezone, and the items that are available and not archived, with their sizes. It never returns `ncm`, `cfop`, `available`, `archived_at`, or another restaurant's rows. Only `app_service` can execute it (FR-221, FR-222).
* `getPublicMenu(deps, publicId)` in `@mt/http` calls the function through `withoutContext`. A malformed id returns `null` without a query. The result never contains the internal restaurant id.
* The page groups meals and drinks by category. It marks the items offered today, in the restaurant timezone, and shows the weekdays of the others. When the restaurant has a phone, a button opens WhatsApp to order (FR-223).
* The menu screen has a "Cardápio público" button that opens the link (FR-224).

## Consequences

* The page shows prices but takes no orders. Orders still come through WhatsApp, the AI assistant, or New order.
* Anyone with the link sees the restaurant name, phone, and menu. These are public by nature.
* A restaurant cannot change its `public_id` in v1. A leaked link stays valid while the restaurant exists.
* Unknown or malformed ids get the Next.js 404 page. The response does not say whether the restaurant exists.
