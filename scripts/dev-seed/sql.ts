// scripts/dev-seed/sql.ts
//
// SQL literal helpers for the seed generator (pattern from web-nf
// scripts/dev-seed/sql.ts). supabase/seed.sql is plain SQL with no bind
// parameters, so every value is a literal or a time expression relative to
// the reset.
//
// Escaping rule: `standard_conforming_strings` is on (the generated file sets
// it), so a single quote is doubled and a backslash is literal.

/** A SQL text literal. */
export function str(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** `null`, or `render(value)`. */
export function nullable<T>(value: T | null | undefined, render: (value: T) => string): string {
  return value === null || value === undefined ? "null" : render(value);
}

/** A text literal, or null. */
export function strOrNull(value: string | null | undefined): string {
  return nullable(value, str);
}

/** A SQL integer literal. */
export function int(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error(`not a safe integer: ${String(value)}`);
  return String(value);
}

/** A `bytea` literal in hex format. */
export function bytea(value: Uint8Array): string {
  return `'\\x${Buffer.from(value).toString("hex")}'::bytea`;
}

/** A `jsonb` literal with object keys sorted, so two runs are byte-identical. */
export function jsonb(value: unknown): string {
  return `${str(JSON.stringify(sortKeys(value)))}::jsonb`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) out[key] = sortKeys(source[key]);
  }
  return out;
}

/** A `smallint[]` literal. */
export function smallintArray(values: readonly number[]): string {
  return `'{${values.map((v) => int(v)).join(",")}}'::smallint[]`;
}

/** A `text[]` literal. */
export function textArray(values: readonly string[]): string {
  return `array[${values.map(str).join(", ")}]::text[]`;
}

export const SEED_TIMEZONE = "America/Sao_Paulo";

/** `now()` minus a number of minutes. Keeps today's fixtures recent at every reset. */
export function minutesAgo(minutes: number): string {
  return `now() - interval '${int(minutes)} minutes'`;
}

/**
 * A local wall-clock time `daysAgo` days before today in the restaurant
 * timezone, as timestamptz. Reports group by the local day, so historical
 * orders anchor to local days, not to `now()`. Renders a call to the
 * `pg_temp.seed_at` helper that `SEED_AT_FUNCTION` defines, which keeps the
 * generated file small.
 */
export function localDayAt(daysAgo: number, hour: number, minute: number): string {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`bad time ${hour}:${minute}`);
  return `pg_temp.seed_at(${int(daysAgo)}, ${int(hour)}, ${int(minute)})`;
}

/** Session-local helper behind `localDayAt`. Dropped with the session. */
export const SEED_AT_FUNCTION = `create function pg_temp.seed_at(p_days integer, p_hour integer, p_minute integer)
returns timestamptz
language sql
stable
as $fn$
  select (date_trunc('day', now() at time zone ${str(SEED_TIMEZONE)})
          - make_interval(days => p_days) + make_interval(hours => p_hour, mins => p_minute))
         at time zone ${str(SEED_TIMEZONE)}
$fn$;
`;

/** `expression + n minutes`. */
export function plusMinutes(expression: string, minutes: number): string {
  return `(${expression} + interval '${int(minutes)} minutes')`;
}

/** One `insert ... values` statement with an explicit column list. */
export function insert(table: string, columns: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) throw new Error(`refusing to emit an empty insert into ${table}`);
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`${table}: row has ${row.length} values for ${columns.length} columns (${columns.join(", ")})`);
    }
  }
  const values = rows.map((row) => `  (${row.join(", ")})`).join(",\n");
  return `insert into ${table} (\n  ${columns.join(", ")}\n) values\n${values};\n`;
}

/** Large inserts split into chunks, so no single statement grows without bound. */
export function insertChunked(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  chunk = 200,
): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i += chunk) parts.push(insert(table, columns, rows.slice(i, i + chunk)));
  return parts.join("\n");
}

/** A banner comment introducing one section of the generated file. */
export function section(title: string, ...notes: readonly string[]): string {
  const rule = "-".repeat(75);
  const body = notes.length === 0 ? "" : `${notes.map((note) => (note === "" ? "--" : `-- ${note}`)).join("\n")}\n`;
  return `-- ${rule}\n-- ${title}\n-- ${rule}\n${body}`;
}
