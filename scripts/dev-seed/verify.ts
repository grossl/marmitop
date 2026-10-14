#!/usr/bin/env bun
// scripts/dev-seed/verify.ts
//
// Proves the seeded local stack works (11.operations.md "Local development",
// step 4). Run by `bun run dev:stack` and `bun run db:reset`, or alone with
// `bun run seed:verify`. Exits 1 on the first failed check group.
//
// Checks:
//   1. row counts per restaurant match the generator (owner connection);
//   2. platform wiring: pg_cron jobs, the Realtime publication, the bucket;
//   3. the app_service DATABASE_URL logs in, and RLS scopes it to one restaurant;
//   4. a seeded secret decrypts under the dev MT_KEK;
//   5. every seeded user signs in through the local Auth API;
//   6. every seeded API key resolves through mt.api_key_lookup.

import { createHash } from "node:crypto";

import { createDb, withoutContext, withRestaurantContext } from "../../packages/db/src/client";
import { REALTIME_TABLES } from "../../packages/db/src/types";
import {
  API_KEYS,
  DEV_ADMIN_DB_URL,
  DEV_API_URL,
  DEV_DB_URL,
  DEV_KEK_BASE64,
  DEV_USER_PASSWORD,
  RESTAURANT_LIST,
  SECRETS,
  USER_LIST,
  USERS,
} from "./constants";
import { open } from "./envelope";
import { seedCounts } from "./generate";

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (ok) console.log(`  ok   ${message}`);
  else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

function anonKey(): string {
  const fromEnv = process.env.SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const proc = Bun.spawnSync(["supabase", "status", "-o", "json"], { stdout: "pipe", stderr: "pipe" });
  const status = JSON.parse(proc.stdout.toString()) as Record<string, string>;
  const key = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
  if (!key) throw new Error("supabase status did not report ANON_KEY");
  return key;
}

async function main(): Promise<void> {
  const owner = createDb(DEV_ADMIN_DB_URL, { max: 2 });
  const service = createDb(DEV_DB_URL, { max: 2 });
  try {
    console.log("1. seeded rows per restaurant");
    const expected = seedCounts();
    for (const restaurant of RESTAURANT_LIST) {
      const want = expected[restaurant.id] ?? {};
      for (const [table, count] of Object.entries(want)) {
        const rows = await owner.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.${table} where restaurant_id = $1`,
          [restaurant.id],
        );
        check(rows[0]?.n === count, `${restaurant.name}: ${table} = ${count} (got ${rows[0]?.n})`);
      }
    }
    const users = await owner<
      { n: number }[]
    >`select count(*)::int as n from auth.users where id = any(${USER_LIST.map((u) => u.id)})`;
    check(users[0]?.n === USER_LIST.length, `auth.users holds the ${USER_LIST.length} seeded users`);

    console.log("2. platform wiring");
    const jobs = await owner<{ n: number }[]>`select count(*)::int as n from cron.job where jobname like 'mt\\_%'`;
    check(jobs[0]?.n === 10, `10 pg_cron jobs scheduled (got ${jobs[0]?.n})`);
    const published = await owner<{ tablename: string }[]>`
      select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`;
    check(
      published.map((r) => r.tablename).join(",") === [...REALTIME_TABLES].sort().join(","),
      `supabase_realtime publishes ${[...REALTIME_TABLES].sort().join(", ")}`,
    );
    const bucket = await owner<{ public: boolean }[]>`select public from storage.buckets where id = 'menu-images'`;
    check(bucket[0]?.public === true, "bucket menu-images exists and is public");

    console.log("3. app_service and RLS");
    const [casa, minas] = RESTAURANT_LIST;
    if (casa === undefined || minas === undefined) throw new Error("two restaurants expected");
    const whoami = await service<{ u: string; bypass: boolean }[]>`
      select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    check(
      whoami[0]?.u === "app_service" && whoami[0]?.bypass === false,
      "DATABASE_URL logs in as app_service (nobypassrls)",
    );
    const seen = await withRestaurantContext(
      service,
      { restaurantId: casa.id, actorType: "user", userId: USERS.casaAdmin.id },
      (tx) => tx<{ restaurant_id: string; n: number }[]>`
        select restaurant_id, count(*)::int as n from public.orders group by 1`,
    );
    check(
      seen.length === 1 && seen[0]?.restaurant_id === casa.id && seen[0]?.n === expected[casa.id]?.orders,
      `${casa.name} admin sees only its own ${expected[casa.id]?.orders} orders`,
    );
    const crossed = await withRestaurantContext(
      service,
      { restaurantId: minas.id, actorType: "user", userId: USERS.casaAdmin.id },
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.orders`,
    );
    check(crossed[0]?.n === 0, `${casa.name} admin pointed at ${minas.name} sees zero orders`);
    const closed = await service.begin((tx) => tx<{ n: number }[]>`select count(*)::int as n from public.orders`);
    check(closed[0]?.n === 0, "no restaurant context sees zero orders (fail closed)");

    console.log("4. secrets decrypt under the dev MT_KEK");
    const secret = SECRETS.casaUatisKey;
    const [row] = await owner<{ ciphertext: Uint8Array; iv: Uint8Array; wrapped_key: Uint8Array }[]>`
      select ciphertext, iv, wrapped_key from public.secrets where id = ${secret.id}`;
    let plaintext = "";
    try {
      if (row) {
        plaintext = open(DEV_KEK_BASE64, secret.restaurant.id, secret.id, secret.kind, {
          ciphertext: row.ciphertext,
          iv: row.iv,
          wrappedKey: row.wrapped_key,
        });
      }
    } catch {
      plaintext = "";
    }
    check(plaintext === secret.plaintext, `${secret.kind} of ${secret.restaurant.name} decrypts`);

    console.log("5. seeded users sign in");
    const apikey = anonKey();
    for (const user of USER_LIST) {
      const res = await fetch(`${DEV_API_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey, "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password: DEV_USER_PASSWORD }),
      });
      const body = (await res.json().catch(() => ({}))) as { user?: { id?: string } };
      check(res.ok && body.user?.id === user.id, `${user.email} signs in (HTTP ${res.status})`);
      const memberships = await withoutContext(
        service,
        (tx) => tx<{ restaurant_id: string; role: string }[]>`select * from mt.memberships_for_user(${user.id})`,
      );
      check(
        memberships.length === 1 &&
          memberships[0]?.restaurant_id === user.restaurant.id &&
          memberships[0]?.role === user.role,
        `${user.email} is ${user.role} of ${user.restaurant.name}`,
      );
    }

    console.log("6. API keys resolve by hash");
    for (const key of API_KEYS) {
      const hash = createHash("sha256").update(key.plaintext).digest("hex");
      const rows = await withoutContext(
        service,
        (tx) => tx<{ id: string; revoked_at: Date | null }[]>`select id, revoked_at from mt.api_key_lookup(${hash})`,
      );
      check(
        rows[0]?.id === key.id && (rows[0]?.revoked_at !== null) === key.revoked,
        `${key.restaurant.name} "${key.name}" resolves${key.revoked ? " as revoked" : ""}`,
      );
    }
  } finally {
    await owner.end({ timeout: 5 });
    await service.end({ timeout: 5 });
  }

  if (failures.length > 0) {
    console.error(`\nseed verification failed: ${failures.length} check(s)`);
    process.exit(1);
  }
  console.log("\nseed verified");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
