// packages/http/src/auth/membership.ts
//
// Session → restaurant resolution (T4.1, ADR-004, ADR-005, FR-004, FR-008).
// Input is a verified user id (the Supabase session). Output comes from
// `restaurant_members` only; nothing the browser sends takes part.
//
//   * `mt.memberships_for_user` (security definer) runs before any restaurant
//     context exists, on `app_service` with no context.
//   * Every other read runs inside `withRestaurantContext` as that user, so
//     the `restaurants` and `restaurant_members` policies apply.

import { type MemberRole, withoutContext, withRestaurantContext } from "@mt/db";

import type { UserContext } from "../context";
import type { ServiceDeps } from "../deps";

export interface Membership {
  readonly restaurantId: string;
  readonly role: MemberRole;
}

export interface MembershipWithName extends Membership {
  readonly restaurantName: string;
}

async function membershipRows(deps: ServiceDeps, userId: string): Promise<Membership[]> {
  const rows = await withoutContext(
    deps.db,
    (tx) => tx<{ restaurant_id: string; role: MemberRole }[]>`
      select restaurant_id, role from mt.memberships_for_user(${userId}::uuid)
    `,
    "app_service",
  );
  return rows.map((r) => ({ restaurantId: r.restaurant_id, role: r.role }));
}

/** Every restaurant the user belongs to, oldest membership first, with names. */
export async function listMemberships(deps: ServiceDeps, userId: string): Promise<MembershipWithName[]> {
  const memberships = await membershipRows(deps, userId);
  const result: MembershipWithName[] = [];
  for (const m of memberships) {
    const rows = await withRestaurantContext(
      deps.db,
      { restaurantId: m.restaurantId, actorType: "user", userId },
      (tx) => tx<{ name: string }[]>`select name from public.restaurants where id = ${m.restaurantId}`,
      deps.contextOptions,
    );
    const name = rows[0]?.name;
    if (name !== undefined) result.push({ ...m, restaurantName: name });
  }
  return result;
}

/** The user's role in one restaurant, re-read under that restaurant's context. Null when not a member. */
export async function loadMembership(
  deps: ServiceDeps,
  userId: string,
  restaurantId: string,
): Promise<Membership | null> {
  const rows = await withRestaurantContext(
    deps.db,
    { restaurantId, actorType: "user", userId },
    (tx) => tx<{ role: MemberRole }[]>`
      select role from public.restaurant_members
      where restaurant_id = ${restaurantId} and user_id = ${userId}
    `,
    deps.contextOptions,
  );
  const role = rows[0]?.role;
  return role === undefined ? null : { restaurantId, role };
}

/**
 * The service context for a signed-in user. v1 assumes one restaurant per
 * user (ADR-005): the oldest membership wins. Null when the user has none.
 */
export async function resolveUserContext(deps: ServiceDeps, userId: string): Promise<UserContext | null> {
  const first = (await membershipRows(deps, userId))[0];
  if (first === undefined) return null;
  const membership = await loadMembership(deps, userId, first.restaurantId);
  if (membership === null) return null;
  return { actorType: "user", userId, restaurantId: membership.restaurantId, role: membership.role };
}
