// The print-job API over HTTP (06.api-spec.md "Print jobs"). The key goes in the
// Authorization header only and never into an error message (NFR-064).

import type { ClaimedJob, PrintJobApi } from "./ports";

const TIMEOUT_MS = 10_000;

export class HttpPrintJobApi implements PrintJobApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (!res.ok) throw new Error(`POST ${path} answered ${res.status} ${json?.error?.code ?? ""}`.trim());
    return json;
  }

  async claim(limit: number): Promise<ClaimedJob[]> {
    const body = (await this.post("/v1/print-jobs/claim", { limit })) as { data: ClaimedJob[] };
    return body.data;
  }

  async report(id: string, result: { printed: true } | { printed: false; error: string }): Promise<void> {
    await this.post(`/v1/print-jobs/${encodeURIComponent(id)}/result`, result);
  }
}
