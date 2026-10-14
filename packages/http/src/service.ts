// packages/http/src/service.ts
//
// The service pattern (packages/http/README.md). A service is a function
// `(deps, ctx, input) => Promise<output>` built by `defineService`, which
// fixes the order of checks for every use case:
//
//   1. role     — `requireRole(ctx, minRole)`, authoritative (ADR-005, FR-006)
//   2. input    — Zod parse, `validation_failed` with field paths (FR-144)
//   3. run      — inside `withRestaurantContext`, so RLS sees the restaurant
//                 and the actor before the first statement (NFR-002)
//
// Steps 1 and 2 touch no database. A refused call costs nothing.

import { type Tx, withRestaurantContext } from "@mt/db";
import { parseOrThrow } from "@mt/schemas";
import type { z, ZodTypeAny } from "zod";

import { requireRole } from "./auth/roles";
import { type Role, type ServiceContext, toDbContext } from "./context";
import type { ServiceDeps } from "./deps";

export interface ServiceArgs<I> {
  readonly tx: Tx;
  readonly deps: ServiceDeps;
  readonly ctx: ServiceContext;
  readonly input: I;
}

export interface ServiceDefinition<S extends ZodTypeAny, O> {
  /** `domain.useCase`, for logs and audit rows. */
  readonly name: string;
  readonly minRole: Role;
  readonly input: S;
  readonly run: (args: ServiceArgs<z.output<S>>) => Promise<O>;
}

export interface Service<S extends ZodTypeAny, O> {
  (deps: ServiceDeps, ctx: ServiceContext, input: z.input<S>): Promise<O>;
  readonly serviceName: string;
  readonly minRole: Role;
  readonly inputSchema: S;
}

export function defineService<S extends ZodTypeAny, O>(def: ServiceDefinition<S, O>): Service<S, O> {
  const service = async (deps: ServiceDeps, ctx: ServiceContext, rawInput: z.input<S>): Promise<O> => {
    requireRole(ctx, def.minRole);
    const input = parseOrThrow(def.input, rawInput);
    return withRestaurantContext(
      deps.db,
      toDbContext(ctx),
      (tx) => def.run({ tx, deps, ctx, input }),
      deps.contextOptions,
    );
  };
  return Object.assign(service, { serviceName: def.name, minRole: def.minRole, inputSchema: def.input });
}

