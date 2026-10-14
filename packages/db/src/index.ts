// @mt/db — postgres.js client, restaurant-context wrapper, queue helpers and
// row types (04.architecture.md, 05.data-model.md). No business logic.
//
// Not exported here, on purpose: ./migrate (reads the filesystem relative to
// its module path; import "@mt/db/migrate") and ./test-harness (tests only;
// import "@mt/db/test-harness").

export const packageName = "@mt/db";

export {
  type ActorType,
  type ContextOptions,
  createDb,
  type Db,
  type DbOptions,
  type DbRole,
  type RestaurantContext,
  setRestaurantContext,
  setRole,
  type Tx,
  withoutContext,
  withRestaurantContext,
  withUserSession,
} from "./client";

export {
  archiveJob,
  deleteJob,
  QUEUE_NAMES,
  QUEUES,
  type QueueMessage,
  type QueueMetrics,
  type QueueName,
  queueMetrics,
  readJobs,
  sendJob,
  setJobVisibility,
} from "./queue";

export * from "./types";
