// covers ADR-022
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const COLORS =
  "white|black|gray|zinc|slate|neutral|stone|amber|blue|green|red|orange|purple|emerald|yellow|sky|indigo|violet|rose|pink|teal|cyan|lime";
// Light-only status colors: pale backgrounds, dark text, light borders.
const LIGHT_ONLY = new RegExp(
  `(?<![\\w:-])(?:bg-(?:${COLORS})-(?:50|100|200)|text-(?:${COLORS})-(?:600|700|800|900)|border-(?:${COLORS})-(?:200|300)|bg-white)(?![\\w-])`,
);
const DARK_COLOR = /(?<![\w-])dark:(?:hover:)?(?:bg|text|border)-/;

const files = readdirSync(DIR).filter(
  (f) => (f.endsWith(".tsx") || f.endsWith("-format.ts")) && !f.endsWith(".test.ts"),
);

// Every quoted string, template literal, or JSX attribute value that holds a class list.
function classStrings(src: string): string[] {
  return [...src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

describe("dark mode (ADR-022)", () => {
  test("scans the component files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    test(`${file}: light-only color classes carry a dark: pair`, () => {
      const src = readFileSync(join(DIR, file), "utf8");
      const bad = classStrings(src).filter((s) => LIGHT_ONLY.test(s) && !DARK_COLOR.test(s));
      expect(bad).toEqual([]);
    });
  }
});
