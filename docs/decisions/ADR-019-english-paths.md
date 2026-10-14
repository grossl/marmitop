# ADR-019 — English names for routes, folders, and files

**Status:** accepted · 2026-10-14

## Question

The dashboard routes, their folders, and one component file use Portuguese names (`/mensagens`, `app/(app)/novo-pedido`, `cardapio-page.tsx`). The rest of the code base uses English. The owner asked for English paths. What changes, and what stays in Portuguese?

## Options

1. Rename everything, including UI text and fiscal field names.
2. Rename paths, folders, file names, and code identifiers. Keep UI text and fiscal/legal terms.
3. Keep Portuguese routes.

## Tradeoffs

The UI is pt-BR for the restaurant staff (NFR-040), so its text must stay Portuguese. Fiscal field names (`logradouro`, `bairro`, `codigo_municipio`) are the legal terms that web-nf and SEFAZ use, and the goal forbids simplifying legal terms. Paths and identifiers are developer-facing, so English keeps them consistent with the rest of the code.

## Recommendation and choice

Option 2. This replaces the route list in ADR-004.

| Old route | New route |
|---|---|
| `/mensagens` | `/messages` |
| `/pedidos` | `/orders` |
| `/novo-pedido` | `/new-order` |
| `/contatos` | `/contacts` |
| `/cardapio` | `/menu` |
| `/estoque` | `/stock` |
| `/relatorios` | `/reports` |
| `/configuracoes` | `/settings` |

`components/cardapio-page.tsx` becomes `components/menu-page.tsx` (`CardapioPage` becomes `MenuPage`). Section ids in `lib/nav.ts` use the new route names.

## Consequences

* Old URLs are not redirected. The product has not shipped, so no bookmarks exist.
* Root `package.json` scripts and the `scripts/` folders already have English names and do not change.
