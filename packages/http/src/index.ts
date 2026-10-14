// @mt/http — services shared by apps/dashboard, apps/api, and apps/worker
// (04.architecture.md, ADR-004). See README.md for the service pattern.

export const packageName = "@mt/http";

export {
  listMemberships,
  loadMembership,
  type Membership,
  type MembershipWithName,
  resolveUserContext,
} from "./auth/membership";
export { hasRole, requireRole } from "./auth/roles";
export { type ConfigResult, type MtEnv, readServerConfig, type ServerConfig } from "./config";
export {
  type ApiKeyContext,
  type Role,
  type ServiceContext,
  type SystemContext,
  toDbContext,
  type UserContext,
} from "./context";
export {
  createServiceDeps,
  type GatewayConnection,
  type GatewayFactory,
  type ServiceDeps,
  type ServiceDepsOverrides,
} from "./deps";
export { type ActionError, ERROR_MESSAGES_PT, type MappedError, mapError, toActionError } from "./errors";
export { defineService, type Service, type ServiceArgs, type ServiceDefinition } from "./service";
export * from "./services";
export {
  createSafeFetch,
  type SafeFetch,
  type SafeFetchOptions,
  type SafeRequest,
  type SafeResponse,
} from "./adapters/safe-fetch";
export { UatisGateway, type UatisGatewayOptions } from "./adapters/uatis-gateway";
export {
  SafeFetchWebhookSender,
  type SafeFetchWebhookSenderOptions,
  WEBHOOK_USER_AGENT,
} from "./adapters/webhook-sender";
export { WebNfGateway, type WebNfGatewayOptions } from "./adapters/web-nf-gateway";
