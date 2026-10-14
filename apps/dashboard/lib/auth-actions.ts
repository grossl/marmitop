"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { HOME_PATH } from "@/lib/nav";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Supabase Auth email + password (FR-001, FR-002, Appendix A `login`, `logout`).
// These run before a session exists, so they do not use memberAction.

const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

export interface LoginState {
  readonly error?: string;
  readonly fieldErrors?: Partial<Record<"email" | "password", string>>;
  readonly email?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = { email: formData.get("email"), password: formData.get("password") };
  const parsed = loginSchema.safeParse(raw);
  const email = typeof raw.email === "string" ? raw.email : "";
  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "email" || key === "password") && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors, email };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "O login não está configurado neste ambiente.", email };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // One message for "no such user" and "wrong password": no account-existence oracle.
    return { error: "E-mail ou senha inválidos.", email };
  }
  revalidatePath("/", "layout");
  redirect(HOME_PATH);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // `scope: "local"` ends this browser's session at once (FR-002).
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect("/login");
}
