// Role guard (ADR-005, FR-005, FR-006). Services call it before any query.

import { AppError } from "@mt/core";

import type { Role, ServiceContext } from "../context";

const RANK: Readonly<Record<Role, number>> = { attendant: 1, admin: 2 };

export function hasRole(ctx: Pick<ServiceContext, "role">, minRole: Role): boolean {
  return RANK[ctx.role] >= RANK[minRole];
}

export function requireRole(ctx: Pick<ServiceContext, "role">, minRole: Role): void {
  if (!hasRole(ctx, minRole)) {
    throw new AppError("forbidden", "Your role cannot perform this action.");
  }
}
