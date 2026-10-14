// The Server Action wrapper, framework-free so it can be unit tested
// (06.api-spec.md Appendix A, 04.architecture.md "Error model").
//
// Every action built here:
//   1. resolves the caller on the server: session user → restaurant_members
//      → { restaurantId, role }. Nothing the client sends takes part (FR-008);
//   2. checks the role (adminAction) before anything else runs (FR-006);
//   3. validates input with the @mt/schemas Zod schema (FR-144);
//   4. returns `{ ok: true, data }` or `{ ok: false, error }` and never throws
//      to the browser — except Next's own redirect/notFound signals.
//
// The service the handler calls checks the role again (ADR-005); this check
// only fails fast.

import { AppError, type ErrorCode } from "@mt/core";
import { type ActionError, requireRole, type Role, type ServiceDeps, toActionError, type UserContext } from "@mt/http";
import type { z, ZodTypeAny } from "zod";

export type ActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ActionError };

export interface Caller {
  readonly userId: string;
  /** Null when the user belongs to no restaurant. */
  readonly ctx: UserContext | null;
}

export interface ActionEnvironment {
  /** Null when there is no verified session. */
  resolveCaller(): Promise<Caller | null>;
  getDeps(): ServiceDeps;
  /** Rethrows Next's control-flow errors (`unstable_rethrow`). */
  rethrowFrameworkError(error: unknown): void;
  /** Called for errors that are not AppError/Zod/known SQLSTATE. Never receives the message. */
  logUnexpected(actionName: string, error: unknown): void;
}

export interface ActionSpec<S extends ZodTypeAny> {
  /** `domain.useCase`, for logs. */
  readonly name: string;
  readonly input: S;
}

export interface ActionArgs<I> {
  readonly input: I;
  readonly ctx: UserContext;
  readonly deps: ServiceDeps;
}

export type Action<S extends ZodTypeAny, O> = (input: z.input<S>) => Promise<ActionResult<O>>;

function fail(code: ErrorCode, message: string): never {
  throw new AppError(code, message);
}

export function createActionBuilders(env: ActionEnvironment) {
  function build<S extends ZodTypeAny, O>(
    minRole: Role,
    spec: ActionSpec<S>,
    handler: (args: ActionArgs<z.output<S>>) => Promise<O>,
  ): Action<S, O> {
    return async (rawInput) => {
      try {
        const caller = await env.resolveCaller();
        if (!caller) fail("unauthorized", "No session.");
        if (!caller.ctx) fail("forbidden", "The user belongs to no restaurant.");
        requireRole(caller.ctx, minRole);
        const parsed = spec.input.safeParse(rawInput);
        if (!parsed.success) throw parsed.error;
        const data = await handler({ input: parsed.data, ctx: caller.ctx, deps: env.getDeps() });
        return { ok: true, data };
      } catch (error) {
        env.rethrowFrameworkError(error);
        const actionError = toActionError(error);
        if (actionError.code === "internal_error") env.logUnexpected(spec.name, error);
        return { ok: false, error: actionError };
      }
    };
  }

  return {
    /** Admin or attendant (`AA` in Appendix A). */
    memberAction: <S extends ZodTypeAny, O>(spec: ActionSpec<S>, handler: (args: ActionArgs<z.output<S>>) => Promise<O>) =>
      build("attendant", spec, handler),
    /** Admin only (`A` in Appendix A). */
    adminAction: <S extends ZodTypeAny, O>(spec: ActionSpec<S>, handler: (args: ActionArgs<z.output<S>>) => Promise<O>) =>
      build("admin", spec, handler),
  };
}
