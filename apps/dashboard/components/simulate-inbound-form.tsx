"use client";

import { FlaskConical } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";

import { simulateInboundMessageAction } from "@/app/(app)/mensagens/actions";

// Dev-only control (ADR-002): inserts an inbound message as if the customer
// had written. The route shows it only outside production, to admins.
export function SimulateInboundForm({
  knownPhones,
  onSimulated,
}: {
  knownPhones: readonly string[];
  onSimulated: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await simulateInboundMessageAction({ phone, body, name });
      if (!result.ok) {
        const first = result.error.fieldErrors ? Object.values(result.error.fieldErrors)[0] : undefined;
        toast.error(first ?? result.error.message);
        return;
      }
      setBody("");
      toast.success("Mensagem simulada.");
      onSimulated(result.data.conversationId);
    });

  return (
    <div className="border-t border-sidebar-border px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground"
      >
        <FlaskConical className="h-3.5 w-3.5" /> Simular mensagem do cliente
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <Input
            list="simulate-phones"
            placeholder="Telefone (ex.: 11 98888-7777)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-8 text-sm"
          />
          <datalist id="simulate-phones">
            {knownPhones.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <Input placeholder="Nome (cliente novo)" value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
          <Input placeholder="Mensagem" value={body} onChange={(e) => setBody(e.target.value)} className="h-8 text-sm" />
          <Button size="sm" className="w-full" disabled={pending || !phone.trim() || !body.trim()} onClick={submit}>
            Simular
          </Button>
        </div>
      )}
    </div>
  );
}
