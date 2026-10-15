// scripts/dev-seed/constants.ts
//
// Every fixed credential and identifier the local stack uses, in one place
// (11.operations.md "Local development"). Nothing here is a secret. These
// values exist only inside a `supabase start` stack on a developer's machine,
// are committed on purpose, and open nothing outside it. Never copy them into
// a deployed environment.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * A readable, fixed uuid: `<family>-0000-4000-8000-<n>`. The version (4) and
 * variant (8) nibbles are fixed, so every client accepts the value.
 */
export function devUuid(family: string, n: number): string {
  if (!/^[0-9a-f]{8}$/.test(family)) throw new Error(`uuid family must be 8 hex characters, got "${family}"`);
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) throw new Error(`uuid discriminator out of range: ${n}`);
  return `${family}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** One family per entity, so an id in a log says what it is. */
export const UUID_FAMILY = {
  user: "aaaa0001",
  identity: "aaaa0002",
  restaurant: "bbbb0001",
  member: "bbbb0002",
  hours: "bbbb0003",
  autoMessage: "bbbb0004",
  secret: "cccc0001",
  apiKey: "cccc0002",
  webhookEndpoint: "cccc0003",
  customer: "dddd0001",
  conversation: "dddd0002",
  message: "dddd0003",
  menuItem: "eeee0001",
  menuSize: "eeee0002",
  order: "ffff0001",
  orderItem: "ffff0002",
  invoice: "ffff0003",
  stockItem: "abcd0001",
  stockMovement: "abcd0002",
  auditLog: "ac1d0001",
  usageEvent: "ace50001",
  jobAttempt: "a77e0001",
} as const;

// ---------------------------------------------------------------------------
// Platform credentials (local stack only)
// ---------------------------------------------------------------------------

/**
 * `MT_KEK` for the local stack: 32 bytes (0x00..0x1f), base64. The trivial
 * sequence is deliberate, so nobody mistakes it for a real key.
 */
export const DEV_KEK_BASE64 = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");

/** Password of every seeded Supabase Auth user. Same default login in every sibling project. */
export const DEV_USER_PASSWORD = "qweqwe";

/** Login password the seed attaches to `app_service` (nologin by default, 05.data-model.md). */
export const DEV_APP_SERVICE_PASSWORD = "marmitop-dev-app-service";

export const DEV_DB_HOST_PORT = "127.0.0.1:54422";

/** `DATABASE_URL` for every app: the `app_service` role, never a superuser. */
export const DEV_DB_URL = `postgresql://app_service:${DEV_APP_SERVICE_PASSWORD}@${DEV_DB_HOST_PORT}/postgres`;

/** The migration owner on the local stack (Supabase CLI default). Seed checks and the test harness only. */
export const DEV_ADMIN_DB_URL = `postgresql://postgres:postgres@${DEV_DB_HOST_PORT}/postgres`;

export const DEV_API_URL = "http://127.0.0.1:54421";
export const DEV_STUDIO_URL = "http://127.0.0.1:54423";
export const DEV_MAILPIT_URL = "http://127.0.0.1:54424";
export const DEV_DASHBOARD_URL = "http://localhost:3100";
export const DEV_API_PUBLIC_URL = "http://localhost:3101";

// ---------------------------------------------------------------------------
// Restaurants and users
// ---------------------------------------------------------------------------

export interface SeedRestaurant {
  readonly key: "casa" | "minas";
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly cidade: string;
  readonly uf: string;
  readonly codigoMunicipio: string;
  readonly planCode: "free" | "pro";
}

export const RESTAURANTS = {
  casa: {
    key: "casa",
    id: devUuid(UUID_FAMILY.restaurant, 1),
    name: "Marmita da Casa",
    phone: "(11) 99999-0000",
    email: "contato@marmitadacasa.com.br",
    address: "Rua das Flores, 342 - Vila Madalena",
    cidade: "São Paulo",
    uf: "SP",
    codigoMunicipio: "3550308",
    planCode: "pro",
  },
  minas: {
    key: "minas",
    id: devUuid(UUID_FAMILY.restaurant, 2),
    name: "Sabor de Minas",
    phone: "(31) 98888-1111",
    email: "contato@sabordeminas.com.br",
    address: "Rua da Bahia, 1200 - Centro",
    cidade: "Belo Horizonte",
    uf: "MG",
    codigoMunicipio: "3106200",
    planCode: "free",
  },
} as const satisfies Record<string, SeedRestaurant>;

export const RESTAURANT_LIST: readonly SeedRestaurant[] = [RESTAURANTS.casa, RESTAURANTS.minas];

export interface SeedUser {
  readonly key: string;
  readonly id: string;
  readonly identityId: string;
  readonly email: string;
  readonly name: string;
  readonly restaurant: SeedRestaurant;
  readonly role: "admin" | "attendant";
}

function user(
  key: string,
  n: number,
  email: string,
  name: string,
  restaurant: SeedRestaurant,
  role: "admin" | "attendant",
): SeedUser {
  return {
    key,
    id: devUuid(UUID_FAMILY.user, n),
    identityId: devUuid(UUID_FAMILY.identity, n),
    email,
    name,
    restaurant,
    role,
  };
}

/** `qwe@qwe.com` is the shared default login across Marmitop, web-nf, and backend-uatis. The rest use the reserved `.test` TLD. */
export const USERS = {
  casaAdmin: user("casaAdmin", 1, "qwe@qwe.com", "Carla Mendes", RESTAURANTS.casa, "admin"),
  casaAttendant: user("casaAttendant", 2, "atendente@marmitadacasa.test", "Diego Rocha", RESTAURANTS.casa, "attendant"),
  minasAdmin: user("minasAdmin", 3, "admin@sabordeminas.test", "Helena Prado", RESTAURANTS.minas, "admin"),
  minasAttendant: user("minasAttendant", 4, "atendente@sabordeminas.test", "Igor Lima", RESTAURANTS.minas, "attendant"),
} as const;

export const USER_LIST: readonly SeedUser[] = Object.values(USERS);

// ---------------------------------------------------------------------------
// Per-restaurant integration credentials (stored encrypted, ADR-012)
// ---------------------------------------------------------------------------

export type SecretKind =
  | "uatis_api_key"
  | "uatis_webhook_secret"
  | "webnf_api_key"
  | "webnf_webhook_secret"
  | "outbound_webhook_secret";

export interface SeedSecret {
  readonly id: string;
  readonly restaurant: SeedRestaurant;
  readonly kind: SecretKind;
  readonly plaintext: string;
}

function secret(n: number, restaurant: SeedRestaurant, kind: SecretKind, plaintext: string): SeedSecret {
  return { id: devUuid(UUID_FAMILY.secret, n), restaurant, kind, plaintext };
}

/**
 * The integrations point at the fakes (MT_UATIS_FAKE=1, MT_WEBNF_FAKE=1), so
 * these values only need to round-trip through the secret store.
 */
export const SECRETS = {
  casaUatisKey: secret(1, RESTAURANTS.casa, "uatis_api_key", "obk_test_casa_dev_000000000000000000000001"),
  casaUatisWebhook: secret(2, RESTAURANTS.casa, "uatis_webhook_secret", "whsec_casa_uatis_dev_0000000000000000000002"),
  casaWebnfKey: secret(3, RESTAURANTS.casa, "webnf_api_key", "nfk_test_casa_dev_000000000000000000000003"),
  casaWebnfWebhook: secret(4, RESTAURANTS.casa, "webnf_webhook_secret", "whsec_casa_webnf_dev_0000000000000000000004"),
  casaOutbound: secret(5, RESTAURANTS.casa, "outbound_webhook_secret", "whsec_casa_outbound_dev_000000000000000005"),
  minasUatisKey: secret(6, RESTAURANTS.minas, "uatis_api_key", "obk_test_minas_dev_00000000000000000000006"),
  minasUatisWebhook: secret(
    7,
    RESTAURANTS.minas,
    "uatis_webhook_secret",
    "whsec_minas_uatis_dev_000000000000000000007",
  ),
} as const;

export const SECRET_LIST: readonly SeedSecret[] = Object.values(SECRETS);

/** Base URLs of the local fakes. Nothing listens there unless a developer starts a stub. */
export const FAKE_UATIS_BASE_URL = "http://127.0.0.1:4010";
export const FAKE_WEBNF_BASE_URL = "http://127.0.0.1:4020";

// ---------------------------------------------------------------------------
// Public API keys (ADR-009: `mtk_test_<base62>`, SHA-256 hash stored)
// ---------------------------------------------------------------------------

export interface SeedApiKey {
  readonly id: string;
  readonly restaurant: SeedRestaurant;
  readonly name: string;
  readonly plaintext: string;
  readonly revoked: boolean;
}

export const API_KEYS: readonly SeedApiKey[] = [
  {
    id: devUuid(UUID_FAMILY.apiKey, 1),
    restaurant: RESTAURANTS.casa,
    name: "Integração local",
    plaintext: "mtk_test_CasaDev0000000000000000000000001",
    revoked: false,
  },
  {
    id: devUuid(UUID_FAMILY.apiKey, 2),
    restaurant: RESTAURANTS.casa,
    name: "Chave antiga",
    plaintext: "mtk_test_CasaDev0000000000000000000000002",
    revoked: true,
  },
  {
    id: devUuid(UUID_FAMILY.apiKey, 3),
    restaurant: RESTAURANTS.minas,
    name: "Integração local",
    plaintext: "mtk_test_MinasDev000000000000000000000003",
    revoked: false,
  },
];

export function apiKeyHash(key: SeedApiKey): string {
  return createHash("sha256").update(key.plaintext).digest("hex");
}

/** Display prefix: the environment tag plus the first eight characters of the body. */
export function apiKeyPrefix(key: SeedApiKey): string {
  return key.plaintext.slice(0, "mtk_test_".length + 8);
}
