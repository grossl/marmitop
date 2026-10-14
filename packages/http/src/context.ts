// packages/http/src/context.ts
//
// The request context every service receives (ADR-005, 05.data-model.md
// "Service context"). The caller builds it from verified credentials only:
// the dashboard from the Supabase session plus `restaurant_members`, the api
// from the API key lookup. A service never reads a restaurant id, user id, or
// role from its input (FR-008).

import type { MemberRole } from "@mt/db";
import type { RestaurantContext } from "@mt/db";

export type Role = MemberRole;

interface BaseContext {
  readonly restaurantId: string;
  /** Resolved server-side. The service checks it first (ADR-005); RLS checks it again from data. */
  readonly role: Role;
}

export interface UserContext extends BaseContext {
  readonly actorType: "user";
  readonly userId: string;
}

export interface ApiKeyContext extends BaseContext {
  readonly actorType: "api_key";
  readonly apiKeyId: string;
}

export interface SystemContext extends BaseContext {
  readonly actorType: "system";
}

export type ServiceContext = UserContext | ApiKeyContext | SystemContext;

/** The `mt.set_context` arguments for `ctx`. The role is not passed: `mt.actor_role()` reads it from data. */
export function toDbContext(ctx: ServiceContext): RestaurantContext {
  return {
    restaurantId: ctx.restaurantId,
    actorType: ctx.actorType,
    userId: ctx.actorType === "user" ? ctx.userId : null,
    apiKeyId: ctx.actorType === "api_key" ? ctx.apiKeyId : null,
  };
}
