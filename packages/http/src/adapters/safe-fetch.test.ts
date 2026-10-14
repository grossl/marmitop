// covers FR-148, NFR-014, ADR-009, ADR-017 #4 and #5, 07.security.md "SSRF guard"
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GatewayError } from "@mt/core";

import { createSafeFetch } from "./safe-fetch";

let server: ReturnType<typeof Bun.serve>;
let base: string;
let silent: { port: number; stop: (closeActive?: boolean) => void };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/echo") {
        return Response.json({
          method: req.method,
          body: req.method === "POST" ? await req.text() : null,
          auth: req.headers.get("authorization"),
          host: req.headers.get("host"),
        });
      }
      if (url.pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "/echo" } });
      if (url.pathname === "/slow") {
        await Bun.sleep(400);
        return new Response("late");
      }
      if (url.pathname === "/big") return new Response("x".repeat(5000));
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  // Reads the request, then closes the socket without an answer.
  silent = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.end();
      },
    },
  });
});

afterAll(() => {
  server.stop(true);
  silent.stop(true);
});

async function failure(p: Promise<unknown>): Promise<GatewayError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GatewayError) return e;
    throw new Error(`expected a GatewayError, got ${String(e)}`);
  }
  throw new Error("expected a failure");
}

const dev = createSafeFetch({ allowPrivateHosts: true, timeoutMs: 2000 });

describe("safeFetch with private hosts allowed (development)", () => {
  test("GET returns the status and the body", async () => {
    const r = await dev({ method: "GET", url: `${base}/echo`, headers: { authorization: "Bearer k" } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ method: "GET", auth: "Bearer k" });
  });

  test("POST sends the body byte for byte", async () => {
    const r = await dev({
      method: "POST",
      url: `${base}/echo`,
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(r.body).body).toBe('{"a":1}');
  });

  test("a non-2xx answer comes back as a response, not an error", async () => {
    const r = await dev({ method: "GET", url: `${base}/missing` });
    expect(r.status).toBe(404);
  });

  test("a redirect is not followed", async () => {
    const e = await failure(dev({ method: "GET", url: `${base}/redirect` }));
    expect(e.failure).toEqual({ kind: "http", status: 302, code: "redirect_not_followed" });
  });

  test("a slow answer is a timeout", async () => {
    const quick = createSafeFetch({ allowPrivateHosts: true, timeoutMs: 100 });
    const e = await failure(quick({ method: "GET", url: `${base}/slow` }));
    expect(e.failure.kind).toBe("timeout");
  });

  test("a closed port is a connection error (the request never left)", async () => {
    const e = await failure(dev({ method: "GET", url: "http://127.0.0.1:1/echo" }));
    expect(e.failure.kind).toBe("connection_error");
  });

  test("a socket closed after the request was written is a network error", async () => {
    const e = await failure(dev({ method: "POST", url: `http://127.0.0.1:${silent.port}/x`, body: "{}" }));
    expect(e.failure.kind).toBe("network_error");
  });

  test("a response over the size cap is refused", async () => {
    const small = createSafeFetch({ allowPrivateHosts: true, maxResponseBytes: 1000 });
    const e = await failure(small({ method: "GET", url: `${base}/big` }));
    expect(e.failure).toMatchObject({ kind: "http", code: "response_too_large" });
  });
});

describe("safeFetch with the SSRF guard on (production)", () => {
  const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

  test("http is refused", async () => {
    const prod = createSafeFetch({ allowPrivateHosts: false, resolve: publicResolver });
    const e = await failure(prod({ method: "GET", url: "http://example.com/v1/health" }));
    expect(e.failure).toEqual({ kind: "refused", code: "scheme_not_allowed" });
  });

  test("localhost and private literals are refused", async () => {
    const prod = createSafeFetch({ allowPrivateHosts: false, resolve: publicResolver });
    for (const url of ["https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/x"]) {
      const e = await failure(prod({ method: "GET", url }));
      expect(e.failure).toEqual({ kind: "refused", code: "host_not_allowed" });
    }
  });

  test("user info in the URL is refused", async () => {
    const prod = createSafeFetch({ allowPrivateHosts: false, resolve: publicResolver });
    const e = await failure(prod({ method: "GET", url: "https://u:p@example.com/x" }));
    expect(e.failure).toEqual({ kind: "refused", code: "userinfo_not_allowed" });
  });

  test("a name that resolves to any private address is refused", async () => {
    const prod = createSafeFetch({
      allowPrivateHosts: false,
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.7", family: 4 },
      ],
    });
    const e = await failure(prod({ method: "GET", url: "https://uatis.example.com/v1/messages" }));
    expect(e.failure).toEqual({ kind: "refused", code: "host_not_allowed" });
  });

  test("a DNS failure is a connection error", async () => {
    const prod = createSafeFetch({
      allowPrivateHosts: false,
      resolve: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    const e = await failure(prod({ method: "GET", url: "https://nowhere.example.com/x" }));
    expect(e.failure.kind).toBe("connection_error");
  });
});
