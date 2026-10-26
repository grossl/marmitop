"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// next-themes 0.4.6 renders its no-flash <script> from a client component, and React 19 warns
// ("Encountered a script tag while rendering React component"). The server HTML keeps the real
// script, so it still runs before paint. On the client the script is inert JSON, so React does
// not warn about a script it would never run anyway.
const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider scriptProps={scriptProps} {...props} />;
}
