# ADR-022 — Dark mode

**Status:** accepted · 2026-10-14

## Question

The owner asked for a dark mode. The dashboard has a `.dark` token block from the shadcn template (neutral grays, white primary) that does not match the Marmitop brand, nothing switches to it, and about 180 hard-coded color classes (`bg-amber-50`, `text-green-700`, …) in status badges and KPI cards would stay light on a dark page. How do we add it?

## Options

1. Invert colors with a CSS filter. Cheap, but images, charts, and brand colors break.
2. Class-based theme with `next-themes`, brand-matched dark tokens, and `dark:` variants for the hard-coded colors.
3. A second stylesheet per theme.

## Choice

Option 2.

* `next-themes` `ThemeProvider` in the root layout, `attribute="class"`, default `system`, stored per browser. No flash on load (`suppressHydrationWarning` on `<html>`).
* A theme switch (Claro / Escuro / Sistema) in the nav sidebar, next to logout. The login page follows the system theme.
* The `.dark` tokens are rewritten to match the brand: warm dark surfaces (low-chroma hue near the terracotta), the terracotta primary kept recognizable, readable muted text (WCAG AA 4.5:1 for body text), and chart colors that keep their meaning.
* Hard-coded status and KPI colors stay as they are in light mode. Each gets a `dark:` pair (for example `bg-amber-50 text-amber-700` → add `dark:bg-amber-500/15 dark:text-amber-300`). Semantic tokens are preferred where a token fits.
* Charts (recharts) read colors from CSS variables, so they follow the theme.
* The theme is a per-browser preference, not stored in the database.

## Consequences

* New components must use tokens or carry `dark:` pairs. A unit test scans `apps/dashboard/components` for status color classes without a `dark:` pair.
