// packages/http/src/services/restaurant-profile.ts
//
// Settings → Perfil (FR-080, 06.api-spec.md Appendix A `getSettings` profile
// part and `saveProfile`). Admin only.

import { AppError } from "@mt/core";
import type { RestaurantRow } from "@mt/db";
import { saveProfileSchema } from "@mt/schemas";
import { z } from "zod";

import { defineService } from "../service";

export interface RestaurantProfile {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly codigoMunicipio: string | null;
  readonly planCode: string;
}

type ProfileRow = Pick<
  RestaurantRow,
  "id" | "name" | "phone" | "email" | "address" | "cidade" | "uf" | "codigo_municipio" | "plan_code"
>;

function toProfile(row: ProfileRow): RestaurantProfile {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    cidade: row.cidade,
    uf: row.uf,
    codigoMunicipio: row.codigo_municipio,
    planCode: row.plan_code,
  };
}

export const getRestaurantProfile = defineService({
  name: "settings.getProfile",
  minRole: "admin",
  input: z.undefined(),
  run: async ({ tx, ctx }) => {
    const [row] = await tx<ProfileRow[]>`
      select id, name, phone, email, address, cidade, uf, codigo_municipio, plan_code
      from public.restaurants where id = ${ctx.restaurantId}
    `;
    if (row === undefined) throw new AppError("not_found", "Restaurant not found.");
    return toProfile(row);
  },
});

export const updateRestaurantProfile = defineService({
  name: "settings.saveProfile",
  minRole: "admin",
  input: saveProfileSchema,
  run: async ({ tx, ctx, input }) => {
    const [row] = await tx<ProfileRow[]>`
      update public.restaurants set
        name = ${input.name},
        phone = ${input.phone},
        email = ${input.email},
        address = ${input.address},
        cidade = ${input.cidade},
        uf = ${input.uf},
        codigo_municipio = ${input.codigoMunicipio}
      where id = ${ctx.restaurantId}
      returning id, name, phone, email, address, cidade, uf, codigo_municipio, plan_code
    `;
    // RLS hides the row when `mt.actor_role()` (read from data) is not admin,
    // even if the context claimed admin. The service check is the first line;
    // this is the second.
    if (row === undefined) throw new AppError("forbidden", "Your role cannot perform this action.");
    return toProfile(row);
  },
});
