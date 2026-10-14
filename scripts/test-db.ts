#!/usr/bin/env bun
// scripts/test-db.ts
//
// Builds or refreshes the integration-test database and prints its URL
// (10.testing.md "Integration tests"). The work lives in
// packages/db/src/test-database.ts, which the test harness also calls, so
// running this by hand is optional.
//
//   bun scripts/test-db.ts            create or update mt_test, print the URL
//
// Needs the local Supabase stack (`bun run dev:stack`), or TEST_DATABASE_URL
// pointing at a Postgres with the pgmq extension available.

import { ensureTestDatabase, TestDatabaseUnavailable } from "../packages/db/src/test-database";

try {
  const url = await ensureTestDatabase({ log: (message) => console.log(message) });
  console.log(`TEST_DATABASE_URL=${url}`);
} catch (error) {
  if (error instanceof TestDatabaseUnavailable) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
