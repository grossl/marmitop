// covers FR-006, FR-008, FR-144 — every Server Action resolves the caller on
// the server, checks the role, validates input, and returns a typed result.
import { describe, expect, test } from "bun:test";
import { AppError } from "@mt/core";
import type { ServiceDeps, UserContext } from "@mt/http";
import { z } from "zod";

import { createActionBuilders, type ActionEnvironment } from "./action-core";

const deps = {} as ServiceDeps;
const RID = "00000000-0000-4000-8000-0000000000aa";
const UID = "00000000-0000-4000-8000-0000000000bb";

function env(ctx: UserContext | null | "anonymous"): ActionEnvironment {
  return {
    resolveCaller: async () =>
      ctx === "anonymous" ? null : { userId: UID, ctx },
    getDeps: () => deps,
    rethrowFrameworkError: (e) => {
      if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    },
    logUnexpected: () => {},
  };
}

const attendant: UserContext = { actorType: "user", userId: UID, restaurantId: RID, role: "attendant" };
const admin: UserContext = { ...attendant, role: "admin" };

describe("memberAction", () => {
  test("hands the handler the server-resolved context, never a client id", async () => {
    const { memberAction } = createActionBuilders(env(attendant));
    const action = memberAction({ name: "t", input: z.object({ restaurantId: z.string().optional() }) }, async ({ ctx }) => ctx.restaurantId);
    const result = await action({ restaurantId: "forged" });
    expect(result).toEqual({ ok: true, data: RID });
  });

  test("an anonymous caller gets unauthorized", async () => {
    const { memberAction } = createActionBuilders(env("anonymous"));
    const result = await memberAction({ name: "t", input: z.undefined() }, async () => 1)(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  test("a user with no restaurant gets forbidden", async () => {
    const { memberAction } = createActionBuilders(env(null));
    const result = await memberAction({ name: "t", input: z.undefined() }, async () => 1)(undefined);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("forbidden");
  });

  test("invalid input is validation_failed with field errors, and the handler does not run", async () => {
    let ran = false;
    const { memberAction } = createActionBuilders(env(admin));
    const action = memberAction({ name: "t", input: z.object({ name: z.string().min(1, "Informe o nome.") }) }, async () => {
      ran = true;
    });
    const result = await action({ name: "" });
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.fieldErrors).toEqual({ name: "Informe o nome." });
    expect(ran).toBe(false);
  });

  test("an AppError from the service becomes a typed error result", async () => {
    const { memberAction } = createActionBuilders(env(admin));
    const result = await memberAction({ name: "t", input: z.undefined() }, async () => {
      throw new AppError("conflict", "dup");
    })(undefined);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toEqual({ code: "conflict", message: "Já existe um registro com estes dados." });
  });

  test("an unexpected error is internal_error and is logged", async () => {
    const logged: string[] = [];
    const e = { ...env(admin), logUnexpected: (name: string) => logged.push(name) };
    const { memberAction } = createActionBuilders(e);
    const result = await memberAction({ name: "orders.list", input: z.undefined() }, async () => {
      throw new Error("db down password=x");
    })(undefined);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("internal_error");
    expect(JSON.stringify(result)).not.toContain("password");
    expect(logged).toEqual(["orders.list"]);
  });

  test("framework control flow (redirect, notFound) propagates", async () => {
    const { memberAction } = createActionBuilders(env(admin));
    const action = memberAction({ name: "t", input: z.undefined() }, async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(action(undefined)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("adminAction", () => {
  test("refuses an attendant with forbidden before the handler runs", async () => {
    let ran = false;
    const { adminAction } = createActionBuilders(env(attendant));
    const result = await adminAction({ name: "t", input: z.undefined() }, async () => {
      ran = true;
    })(undefined);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("forbidden");
    expect(ran).toBe(false);
  });

  test("lets an admin through", async () => {
    const { adminAction } = createActionBuilders(env(admin));
    expect(await adminAction({ name: "t", input: z.undefined() }, async () => "ok")(undefined)).toEqual({ ok: true, data: "ok" });
  });
});
