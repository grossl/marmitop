"use client";

import { Button } from "@mt/ui/components/button";
import { Minus, Plus } from "lucide-react";

/** "Adicionar" when the quantity is zero, then − qty +. Every button is 44 px high (FR-237). */
export function Stepper({ label, qty, onChange }: { label: string; qty: number; onChange: (qty: number) => void }) {
  if (qty === 0) {
    return (
      <Button
        variant="outline"
        className="h-11 gap-1.5 px-4"
        onClick={() => onChange(1)}
        aria-label={`Adicionar ${label}`}
      >
        <Plus className="h-4 w-4" /> Adicionar
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background">
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={() => onChange(qty - 1)}
        aria-label={`Remover um ${label}`}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
        {qty}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={() => onChange(qty + 1)}
        aria-label={`Adicionar mais um ${label}`}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
