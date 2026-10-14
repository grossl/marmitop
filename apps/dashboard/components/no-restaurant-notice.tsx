import { Alert, AlertDescription, AlertTitle } from "@mt/ui/components/alert";
import { Button } from "@mt/ui/components/button";

import { logoutAction } from "@/lib/auth-actions";

/** A signed-in user with no `restaurant_members` row (FR-004). */
export function NoRestaurantNotice({ email }: { email: string | undefined }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Alert className="max-w-md">
        <AlertTitle>Nenhum restaurante vinculado</AlertTitle>
        <AlertDescription>
          <p>A conta {email ?? ""} não pertence a nenhum restaurante. Peça a um administrador para adicionar você.</p>
          <form action={logoutAction} className="mt-3">
            <Button type="submit" variant="outline" size="sm">
              Sair
            </Button>
          </form>
        </AlertDescription>
      </Alert>
    </main>
  );
}
