// The production printer: raw bytes to a CUPS queue with `lp -o raw` (ADR-038).
// The queue has no driver, so CUPS passes the ESC/POS bytes through unchanged.

import type { TicketPrinter } from "./ports";

export class CupsPrinter implements TicketPrinter {
  constructor(private readonly queue: string) {}

  async print(bytes: Uint8Array): Promise<void> {
    const proc = Bun.spawn(["lp", "-d", this.queue, "-o", "raw"], { stdin: bytes, stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) throw new Error(`lp exited ${code}: ${stderr.trim()}`);
  }
}
