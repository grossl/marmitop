// packages/db/src/client.ts
//
// The connection layer (05.data-model.md "Service context", ADR-005). Its one
// job is to make the restaurant context mechanical:
//
//   * `createDb(url)`                — a postgres.js client.
//   * `withRestaurantContext(...)`   — a transaction that calls
//                                      `mt.set_context(...)` before the first
//                                      statement. No other code path opens a
//                                      transaction on `app_service`.
//   * `withUserSession(...)`         — the browser path (role `authenticated`
//                                      with `auth.uid()`), for tests of the
//                                      Realtime read policies.
//   * `withoutContext(...)`          — the fail-closed case, for tests.
//
// No business logic lives here (04.architecture.md).

import postgres from "postgres";

/** A postgres.js client. */
export type Db = postgres.Sql<Record<string, unknown>>;

/** A postgres.js transaction handle, as handed to `db.begin` callbacks. */
export type Tx = postgres.TransactionSql<Record<string, unknown>>;

/** Connection options, minus the ones this package owns. */
export type DbOptions = postgres.Options<Record<string, postgres.PostgresType>>;

/** The Postgres roles Marmitop talks to (05.data-model.md "Access model"). */
export type DbRole = "app_service" | "authenticated" | "anon";

/** `app.actor_type` values accepted by `mt.set_context`. */
export type ActorType = "user" | "api_key" | "system";

/** What every service transaction declares before its first query. */
export interface RestaurantContext {
  readonly restaurantId: string;
  readonly actorType: ActorType;
  /** `auth.users.id`, for `user` actors. */
  readonly userId?: string | null;
  /** `api_keys.id`, for `api_key` actors. */
  readonly apiKeyId?: string | null;
}

export interface ContextOptions {
  /**
   * `set local role` before the context. Deployments connect as
   * `app_service` and leave this unset. Tests connect as the migration owner
   * and pass `"app_service"` to walk the production path.
   */
  readonly role?: DbRole;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * int8 columns (money in cents, counts, pgmq ids) parse to `number`. Every
 * value this schema stores in int8 stays far below 2^53, and cents as
 * integers are exact (ADR-006). numeric columns stay strings.
 */
const INT8_AS_NUMBER = {
  to: 20,
  from: [20],
  serialize: (value: number | bigint | string) => String(value),
  parse: (value: string) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new RangeError(`int8 value ${value} is outside the safe integer range`);
    }
    return parsed;
  },
};

/** Creates a postgres.js client. */
export function createDb(url: string, options: DbOptions = {}): Db {
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    ...options,
    types: { int8: INT8_AS_NUMBER, ...(options.types ?? {}) },
  }) as unknown as Db;
}

/** `set local role <role>`. The name cannot be a bind parameter, so it is checked against a strict pattern. */
export async function setRole(tx: Tx, role: DbRole): Promise<void> {
  if (!IDENTIFIER.test(role)) {
    throw new Error(`refusing to set role from an unsafe identifier: ${JSON.stringify(role)}`);
  }
  await tx.unsafe(`set local role ${role}`);
}

/** Calls `mt.set_context` on an open transaction. Transaction-local by construction. */
export async function setRestaurantContext(tx: Tx, ctx: RestaurantContext): Promise<void> {
  await tx`
    select mt.set_context(
      ${ctx.restaurantId}::uuid,
      ${ctx.actorType}::text,
      ${ctx.userId ?? null}::uuid,
      ${ctx.apiKeyId ?? null}::uuid
    )
  `;
}

/**
 * Runs `fn` inside a transaction whose restaurant context is `ctx`
 * (05.data-model.md "Service context"). The context is transaction-local, so
 * it cannot leak to the next user of a pooled connection.
 */
export function withRestaurantContext<T>(
  db: Db,
  ctx: RestaurantContext,
  fn: (tx: Tx) => Promise<T>,
  options: ContextOptions = {},
): Promise<T> {
  return db.begin(async (tx) => {
    if (options.role !== undefined) await setRole(tx as Tx, options.role);
    await setRestaurantContext(tx as Tx, ctx);
    return fn(tx as Tx);
  }) as Promise<T>;
}

/**
 * The browser path: role `authenticated` with `auth.uid()` resolving to
 * `userId`. In production PostgREST and Realtime set these from the session
 * JWT; server code never uses this path for data (ADR-004).
 */
export function withUserSession<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await setRole(tx as Tx, "authenticated");
    return fn(tx as Tx);
  }) as Promise<T>;
}

/** A transaction under `role` with no restaurant context: every tenant policy matches zero rows. */
export function withoutContext<T>(db: Db, fn: (tx: Tx) => Promise<T>, role: DbRole = "app_service"): Promise<T> {
  return db.begin(async (tx) => {
    await setRole(tx as Tx, role);
    return fn(tx as Tx);
  }) as Promise<T>;
}
