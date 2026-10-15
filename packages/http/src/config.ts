// packages/http/src/config.ts
//
// Server configuration from the environment (04.architecture.md "Configuration").
// Never throws and never echoes a value: a missing or malformed variable is
// reported by name, so the dashboard can render a setup notice (NFR-011).

import { parseKek } from "@mt/core";

export type MtEnv = "development" | "test" | "production";

export interface ServerConfig {
  readonly databaseUrl: string;
  /** `MT_KEK`, 32 bytes (ADR-012). */
  readonly kek: Uint8Array;
  /** `MT_KEK_VERSION`, default 1. Stamped on new `secrets` rows; rotation increments it (07.security.md). */
  readonly kekVersion: number;
  /** `MT_KEK_PREVIOUS`, only during a KEK rotation. Its version is `kekVersion - 1`. */
  readonly kekPrevious: Uint8Array | undefined;
  /** `MT_UATIS_FAKE=1` selects `FakeGateway` (ADR-017). */
  readonly uatisFake: boolean;
  /** `MT_WEBNF_FAKE=1` selects `FakeInvoiceGateway` (ADR-017). */
  readonly webnfFake: boolean;
  readonly env: MtEnv;
  /**
   * `MT_ALLOW_PRIVATE_HOSTS=1`: the SSRF guard allows `http:` and private hosts
   * (local development only, ADR-017 #5). Refused when `MT_ENV` is production.
   */
  readonly allowPrivateHosts: boolean;
  /**
   * `MT_PUBLIC_URL`: the public base URL of apps/api. "Ativar webhook" registers a push webhook
   * when it is public https on port 443, and a pull webhook otherwise (ADR-021, ADR-023, FR-172).
   * Kept as given; `checkPublicBaseUrl` decides. Undefined when unset.
   */
  readonly publicUrl: string | undefined;
  /** `MT_UATIS_PULL_SECONDS`, 1..60, default 3: the event-feed cadence in pull mode (FR-174). */
  readonly uatisPullSeconds: number;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

type Env = Readonly<Record<string, string | undefined>>;

function tryKek(value: string | undefined): Uint8Array | undefined {
  if (!value) return undefined;
  try {
    return parseKek(value);
  } catch {
    return undefined;
  }
}

function readEnvName(value: string | undefined): MtEnv {
  return value === "development" || value === "test" ? value : "production";
}

export function readServerConfig(env_: Env = process.env): ConfigResult {
  const missing: string[] = [];
  const databaseUrl = env_.DATABASE_URL;
  if (!databaseUrl) missing.push("DATABASE_URL");
  const kek = tryKek(env_.MT_KEK);
  if (!kek) missing.push("MT_KEK");
  const kekPrevious = tryKek(env_.MT_KEK_PREVIOUS);
  if (env_.MT_KEK_PREVIOUS && !kekPrevious) missing.push("MT_KEK_PREVIOUS");
  const kekVersion = env_.MT_KEK_VERSION === undefined || env_.MT_KEK_VERSION === "" ? 1 : Number(env_.MT_KEK_VERSION);
  if (!Number.isInteger(kekVersion) || kekVersion < 1 || kekVersion > 32767) missing.push("MT_KEK_VERSION");
  if (kekPrevious && kekVersion < 2) missing.push("MT_KEK_VERSION");
  const env = readEnvName(env_.MT_ENV);
  const allowPrivateHosts = env_.MT_ALLOW_PRIVATE_HOSTS === "1";
  if (allowPrivateHosts && env === "production") missing.push("MT_ALLOW_PRIVATE_HOSTS");
  const pullRaw = env_.MT_UATIS_PULL_SECONDS;
  const uatisPullSeconds = pullRaw === undefined || pullRaw === "" ? 3 : Number(pullRaw);
  if (!Number.isInteger(uatisPullSeconds) || uatisPullSeconds < 1 || uatisPullSeconds > 60) {
    missing.push("MT_UATIS_PULL_SECONDS");
  }
  if (missing.length > 0 || !databaseUrl || !kek) return { ok: false, missing };

  return {
    ok: true,
    config: {
      databaseUrl,
      kek,
      kekVersion,
      kekPrevious,
      uatisFake: env_.MT_UATIS_FAKE === "1",
      webnfFake: env_.MT_WEBNF_FAKE === "1",
      env,
      allowPrivateHosts,
      publicUrl: env_.MT_PUBLIC_URL?.trim() || undefined,
      uatisPullSeconds,
    },
  };
}
