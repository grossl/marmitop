import { Alert, AlertDescription, AlertTitle } from "@mt/ui/components/alert";

/** Shown when the server environment is incomplete. Names variables, never values. */
export function SetupNotice({ missing }: { missing: readonly string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Alert className="max-w-lg">
        <AlertTitle>Ambiente não configurado</AlertTitle>
        <AlertDescription>
          <p>Defina estas variáveis e reinicie o servidor:</p>
          <ul className="mt-2 list-disc pl-5 font-mono text-xs">
            {missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-2">Em desenvolvimento, rode <code>bun run dev:stack</code>.</p>
        </AlertDescription>
      </Alert>
    </main>
  );
}
