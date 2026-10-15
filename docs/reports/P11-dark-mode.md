# P11 — Dark mode (ADR-022)

## Done

* `app/layout.tsx`: `next-themes` `ThemeProvider` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`). `<html>` has `suppressHydrationWarning`.
* `components/nav-sidebar.tsx`: theme switch above logout. A dropdown offers Claro, Escuro, and Sistema. It renders a neutral icon until mounted, so there is no hydration mismatch.
* `app/globals.css`: the `.dark` block is rewritten. Warm low-chroma surfaces (hue 50), terracotta primary kept (hue 42), dark sidebar kept, order tokens given dark values.
* `dark:` pairs added to every hard-coded color class in `orders-page`, `messaging-format`, `orders-format`, `finance-page`, `reports-page`, `invoice-panel`, `menu-page`, `stock-page`, and `settings-page` (`bg-white` became `bg-card`). The pattern is `bg-X-50 dark:bg-X-500/15`, `text-X-700 dark:text-X-300`, `border-X-200 dark:border-X-500/30`.
* Recharts colors now read CSS variables (`var(--primary)`, `var(--border)`, `var(--muted-foreground)`, `var(--chart-5)`).
* `components/dark-mode.test.ts` (covers ADR-022) fails when a light-only color class has no `dark:` pair in the same class string.

## Verified

* `bun run typecheck` and `bun test` (71 tests) pass in `apps/dashboard`.
* Browser, dark scheme, 1400x900: /orders (board and order dialog), /messages, /new-order, /contacts, /menu, /stock, /reports (charts render), /finance, /settings (restaurant and WhatsApp tabs). All readable.
* Theme switch: menu opens, "Claro" sets `light` on `<html>` and in `localStorage`. The default follows the system scheme.

## Contrast (WCAG ratio, computed from oklch to sRGB)

| Pair | Ratio |
| --- | --- |
| foreground / background | 16.25 |
| foreground / card | 14.98 |
| muted-foreground / background | 7.56 |
| muted-foreground / card | 6.96 |
| muted-foreground / muted | 6.07 |
| primary-foreground / primary | 6.32 |
| primary / background | 6.12 |
| destructive (text) / background | 4.67 |
| destructive-foreground / destructive | 4.95 |
| sidebar-foreground / sidebar | 15.52 |
| sidebar-accent-foreground / sidebar-accent | 12.33 |
| secondary-foreground / secondary | 12.65 |
| accent-foreground / accent | 9.47 |
| chart-1..5 / background | 6.58, 8.02, 6.69, 11.40, 9.12 |

The destructive foreground is near-black, not white. White on this red reaches only 3.9.

## Remaining

* `/login` was not opened in the browser (the session is signed in and the proxy redirects). The page uses only tokens, so it follows the theme.
* The `dark:` pairs for status badges (`*-500/15` background, `*-300` text) were checked by eye, not by ratio.
* Screenshots of /orders and /messages were viewed in the browser pane, not saved to disk.
