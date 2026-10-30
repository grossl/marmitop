// packages/core/src/ticket/escpos.ts
//
// ESC/POS bytes for an 80 mm thermal printer (FR-253, ADR-038). Code page 860
// prints Portuguese letters. A character outside it prints without its accent,
// or as "?". Pure: the print agent sends the bytes to the printer.

import type { TicketLine } from "./render";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Code page 860, bytes 0x80..0xFE (0xFF is a no-break space). */
const CP860_HIGH =
  "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■";
const CP860 = new Map<string, number>([...CP860_HIGH].map((ch, i) => [ch, 0x80 + i]));

/** Typographic characters that have a plain ASCII form. */
const PLAIN: Record<string, string> = {
  "\u00a0": " ",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
};

/** One character as code page 860 bytes. */
function encodeChar(ch: string): number[] {
  const code = ch.codePointAt(0) ?? 0x3f;
  if (code >= 0x20 && code < 0x7f) return [code];
  const mapped = CP860.get(ch);
  if (mapped !== undefined) return [mapped];
  const plain = PLAIN[ch];
  if (plain !== undefined) return [...plain].map((c) => c.charCodeAt(0));
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
  if (base !== ch && base.length > 0) return [...base].flatMap(encodeChar);
  return [0x3f];
}

export function encodeCp860(text: string): number[] {
  return [...text.normalize("NFC")].flatMap(encodeChar);
}

export interface EscPosOptions {
  /** Blank lines fed before the cut, so the last line clears the cutter. Default 4. */
  readonly feedLines?: number;
  /** Cut the paper at the end. Default true. */
  readonly cut?: boolean;
}

/** The whole ticket: init, code page 860, each line with its style, feed, and a partial cut. */
export function encodeEscPos(lines: readonly TicketLine[], options: EscPosOptions = {}): Uint8Array {
  const out: number[] = [ESC, 0x40, ESC, 0x74, 3];
  for (const line of lines) {
    out.push(ESC, 0x61, line.align === "center" ? 1 : line.align === "right" ? 2 : 0);
    out.push(ESC, 0x45, line.bold ? 1 : 0);
    out.push(GS, 0x21, line.size === "double" ? 0x11 : 0x00);
    out.push(...encodeCp860(line.text), LF);
  }
  // Reset the style so the next job starts plain even without its own init.
  out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  out.push(ESC, 0x64, options.feedLines ?? 4);
  if (options.cut !== false) out.push(GS, 0x56, 0x42, 0);
  return Uint8Array.from(out);
}
