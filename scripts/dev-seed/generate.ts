#!/usr/bin/env bun
// scripts/dev-seed/generate.ts
//
// Writes supabase/seed.sql (11.operations.md "Local development"). Run with
// `bun run seed:generate`. The output is deterministic: fixed uuids and time
// expressions relative to the reset, so two runs are byte-identical and
// packages/db/src/dev-seed.test.ts can detect drift.
//
// The seed holds accounts and configuration only (ADR-024): logins,
// restaurants, members, settings, business hours, automatic messages, the
// Marmita da Casa fiscal integration with the local web-nf, and public API
// keys. Menu, stock, customers, conversations, orders, and invoices start
// empty and come from real use.
//
// `supabase db reset` runs the file as the migration owner, so the inserts
// bypass RLS the way a DBA does. The triggers still run (the secret-kind check).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_KEYS,
  apiKeyHash,
  apiKeyPrefix,
  DEV_APP_SERVICE_PASSWORD,
  DEV_DB_URL,
  DEV_KEK_BASE64,
  DEV_USER_PASSWORD,
  devUuid,
  LOCAL_WEBNF_BASE_URL,
  RESTAURANTS,
  SECRET_LIST,
  SECRETS,
  type SeedRestaurant,
  USER_LIST,
  USERS,
  UUID_FAMILY,
} from "./constants";
import { CASA, MINAS, type RestaurantContent } from "./data";
import { sealDeterministic } from "./envelope";
import { bytea, insert, int, jsonb, localDayAt, SEED_AT_FUNCTION, section, str } from "./sql";

export const OUTPUT = fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url));

interface RestaurantModel {
  restaurant: SeedRestaurant;
  content: RestaurantContent;
  admin: (typeof USER_LIST)[number];
  attendant: (typeof USER_LIST)[number];
}

function header(): string {
  const lines = [
    "-- supabase/seed.sql",
    "--",
    "-- GENERATED FILE. Do not edit by hand. Regenerate with `bun run seed:generate`",
    "-- (scripts/dev-seed/generate.ts). `supabase db reset` runs it after the",
    "-- migrations, as the migration owner, so the inserts bypass RLS the way a DBA",
    "-- does. The applications still connect as `app_service` (nobypassrls).",
    "--",
    "-- Accounts and configuration only (ADR-024). Menu, stock, customers,",
    "-- conversations, orders, and invoices start empty.",
    "--",
    "-- ===========================================================================",
    "-- LOCAL DEVELOPMENT CREDENTIALS: for the `supabase start` stack only",
    "-- ===========================================================================",
    "-- Committed on purpose. None of these values opens anything outside a",
    "-- developer's machine. Do not copy them into a deployed environment.",
    "--",
    `-- Dashboard sign-in (http://localhost:3100). Password for every user: ${DEV_USER_PASSWORD}`,
    ...USER_LIST.map((u) => `--   ${u.email.padEnd(30)} ${u.role.padEnd(9)} ${u.restaurant.name}`),
    "--",
    `-- DATABASE_URL=${DEV_DB_URL}`,
    `-- MT_KEK=${DEV_KEK_BASE64}`,
    "--",
    "-- Public API keys (Authorization: Bearer ...):",
    ...API_KEYS.map((k) => `--   ${k.restaurant.name}: ${k.plaintext}${k.revoked ? "  [revoked: expect 401]" : ""}`),
    "--",
    `-- ${RESTAURANTS.casa.name} fiscal integration: web-nf ${LOCAL_WEBNF_BASE_URL}, homologacao`,
    "-- (web-nf's own dev key). WhatsApp is not seeded: connect it in Configurações.",
    "-- ===========================================================================",
    "",
    "set standard_conforming_strings = on;",
    "",
    "begin;",
    "",
    SEED_AT_FUNCTION,
  ];
  return `${lines.join("\n")}\n`;
}

function localWiring(): string {
  return (
    section(
      "Local wiring",
      "Migration 0001 creates app_service `nologin`; each environment attaches a",
      "password out of band. On the local stack the seed is that out of band.",
    ) + `alter role app_service with login password ${str(DEV_APP_SERVICE_PASSWORD)};\n`
  );
}

/** GoTrue scans several token columns and breaks on NULLs, so they are empty strings. */
function authUsers(): string {
  const password = `extensions.crypt(${str(DEV_USER_PASSWORD)}, extensions.gen_salt('bf'))`;
  const users = insert(
    "auth.users",
    [
      "instance_id",
      "id",
      "aud",
      "role",
      "email",
      "encrypted_password",
      "email_confirmed_at",
      "raw_app_meta_data",
      "raw_user_meta_data",
      "created_at",
      "updated_at",
      "confirmation_token",
      "recovery_token",
      "email_change",
      "email_change_token_new",
      "email_change_token_current",
      "phone_change",
      "phone_change_token",
      "reauthentication_token",
    ],
    USER_LIST.map((u) => [
      str("00000000-0000-0000-0000-000000000000"),
      str(u.id),
      str("authenticated"),
      str("authenticated"),
      str(u.email),
      password,
      "now()",
      jsonb({ provider: "email", providers: ["email"] }),
      jsonb({ full_name: u.name }),
      "now()",
      "now()",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
      "''",
    ]),
  );
  const identities = insert(
    "auth.identities",
    ["id", "user_id", "provider_id", "provider", "identity_data", "last_sign_in_at", "created_at", "updated_at"],
    USER_LIST.map((u) => [
      str(u.identityId),
      str(u.id),
      str(u.id),
      str("email"),
      jsonb({ sub: u.id, email: u.email, email_verified: true, phone_verified: false }),
      "now()",
      "now()",
      "now()",
    ]),
  );
  return `${section("auth.users + auth.identities", "Email and password, already confirmed.")}${users}\n${identities}`;
}

function restaurants(models: RestaurantModel[]): string {
  const rows = models.map(({ restaurant: r }) => [
    str(r.id),
    str(r.name),
    str(r.phone),
    str(r.email),
    str(r.address),
    str(r.cidade),
    str(r.uf),
    str(r.codigoMunicipio),
    str(r.planCode),
  ]);
  const members = models.flatMap((m) =>
    [m.admin, m.attendant].map((u) => [
      str(devUuid(UUID_FAMILY.member, USER_LIST.indexOf(u) + 1)),
      str(m.restaurant.id),
      str(u.id),
      str(u.role),
    ]),
  );
  const settings = models.map(({ restaurant: r, content: c }) => [
    str(r.id),
    String(c.settings.autoAccept),
    String(c.settings.allowPickup),
    String(c.settings.showDeliveryEstimate),
    int(c.settings.deliveryEstimateMinutes),
    int(c.settings.deliveryFeeCents),
    str("America/Sao_Paulo"),
  ]);
  let hoursN = 0;
  const hours = models.flatMap(({ restaurant: r, content: c }) =>
    c.hours.map((h) => [
      str(devUuid(UUID_FAMILY.hours, ++hoursN)),
      str(r.id),
      int(h.weekday),
      String(h.enabled),
      str(h.opens),
      str(h.closes),
    ]),
  );
  let autoN = 0;
  const autos = models.flatMap(({ restaurant: r, content: c }) =>
    c.automaticMessages.map((a) => [
      str(devUuid(UUID_FAMILY.autoMessage, ++autoN)),
      str(r.id),
      str(a.kind),
      String(a.enabled),
      str(a.body),
    ]),
  );
  return (
    section("restaurants, members, settings, hours, automatic messages (FR-009, FR-080–084)") +
    insert(
      "public.restaurants",
      ["id", "name", "phone", "email", "address", "cidade", "uf", "codigo_municipio", "plan_code"],
      rows,
    ) +
    "\n" +
    insert("public.restaurant_members", ["id", "restaurant_id", "user_id", "role"], members) +
    "\n" +
    insert(
      "public.restaurant_settings",
      [
        "restaurant_id",
        "auto_accept",
        "allow_pickup",
        "show_delivery_estimate",
        "delivery_estimate_minutes",
        "delivery_fee_cents",
        "timezone",
      ],
      settings,
    ) +
    "\n" +
    insert("public.business_hours", ["id", "restaurant_id", "weekday", "enabled", "opens_at", "closes_at"], hours) +
    "\n" +
    insert("public.automatic_messages", ["id", "restaurant_id", "kind", "enabled", "body"], autos)
  );
}

function integrations(): string {
  const secrets = SECRET_LIST.map((s) => {
    const sealed = sealDeterministic(DEV_KEK_BASE64, s.restaurant.id, s.id, s.kind, s.plaintext);
    return [
      str(s.id),
      str(s.restaurant.id),
      str(s.kind),
      bytea(sealed.ciphertext),
      bytea(sealed.iv),
      bytea(sealed.wrappedKey),
      "1",
      str(sealed.last4),
    ];
  });
  return (
    section(
      "secrets and integrations (ADR-012, ADR-024)",
      "Envelope-encrypted under the dev MT_KEK (scripts/dev-seed/envelope.ts).",
      `${RESTAURANTS.casa.name} points at the local web-nf; run it with MT_WEBNF_FAKE=0.`,
      "No WhatsApp integration: backend-uatis has no seeded key that works (ADR-024).",
    ) +
    insert(
      "public.secrets",
      ["id", "restaurant_id", "kind", "ciphertext", "iv", "wrapped_key", "kek_version", "last4"],
      secrets,
    ) +
    "\n" +
    insert(
      "public.integrations_fiscal",
      [
        "restaurant_id",
        "base_url",
        "api_key_secret_id",
        "webhook_secret_id",
        "environment",
        "nfce_serie",
        "nfe_serie",
        "default_ncm",
        "default_cfop",
        "default_csosn",
        "default_pis_cst",
        "default_cofins_cst",
        "delivery_fee_mode",
        "status",
      ],
      [
        [
          str(RESTAURANTS.casa.id),
          str(LOCAL_WEBNF_BASE_URL),
          str(SECRETS.casaWebnfKey.id),
          str(SECRETS.casaWebnfWebhook.id),
          str("homologacao"),
          "1",
          "1",
          str("21069090"),
          str("5102"),
          str("102"),
          str("49"),
          str("49"),
          str("item"),
          str("connected"),
        ],
      ],
    ) +
    "\n" +
    insert(
      "public.api_keys",
      ["id", "restaurant_id", "name", "prefix", "hash", "environment", "created_by", "created_at", "revoked_at"],
      API_KEYS.map((k) => [
        str(k.id),
        str(k.restaurant.id),
        str(k.name),
        str(apiKeyPrefix(k)),
        str(apiKeyHash(k)),
        str("test"),
        str(k.restaurant.key === "casa" ? USERS.casaAdmin.id : USERS.minasAdmin.id),
        k.revoked ? localDayAt(40, 10, 0) : localDayAt(20, 10, 0),
        k.revoked ? localDayAt(21, 10, 0) : "null",
      ]),
    )
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildModels(): RestaurantModel[] {
  return [
    { restaurant: RESTAURANTS.casa, content: CASA, admin: USERS.casaAdmin, attendant: USERS.casaAttendant },
    { restaurant: RESTAURANTS.minas, content: MINAS, admin: USERS.minasAdmin, attendant: USERS.minasAttendant },
  ];
}

export interface SeedCounts {
  [table: string]: number;
}

/** Operational tables the seed leaves empty (ADR-024). verify.ts checks each one holds zero rows. */
export const EMPTY_TABLES = [
  "customers",
  "conversations",
  "messages",
  "menu_items",
  "stock_items",
  "orders",
  "order_invoices",
  "usage_events",
  "webhook_endpoints",
  "integrations_whatsapp",
] as const;

/** Row counts per table and restaurant, which verify.ts checks on the live stack. */
export function seedCounts(models = buildModels()): Record<string, SeedCounts> {
  const out: Record<string, SeedCounts> = {};
  for (const m of models) {
    out[m.restaurant.id] = {
      restaurant_members: 2,
      business_hours: m.content.hours.length,
      automatic_messages: m.content.automaticMessages.length,
      integrations_fiscal: m.restaurant.id === RESTAURANTS.casa.id ? 1 : 0,
      api_keys: API_KEYS.filter((k) => k.restaurant.id === m.restaurant.id).length,
      secrets: SECRET_LIST.filter((s) => s.restaurant.id === m.restaurant.id).length,
      ...Object.fromEntries(EMPTY_TABLES.map((t) => [t, 0])),
    };
  }
  return out;
}

export function renderSeed(): string {
  const models = buildModels();
  return [header(), localWiring(), authUsers(), restaurants(models), integrations(), "commit;\n"].join("\n");
}

if (import.meta.main) {
  const sql = renderSeed();
  writeFileSync(OUTPUT, sql, "utf8");
  console.log(`wrote ${join("supabase", "seed.sql")} (${sql.length} bytes): accounts and configuration only`);
}
