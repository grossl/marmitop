"use client";

// Configurações → Atendente IA (FR-180, FR-196, FR-197; 12.ai-order-assistant.md "Dashboard").

import type { AiQuota, AiSettings } from "@mt/http";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Label } from "@mt/ui/components/label";
import { Switch } from "@mt/ui/components/switch";
import { Textarea } from "@mt/ui/components/textarea";
import { Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveAiSettingsAction } from "@/app/(app)/settings/actions";
import { formatBRL } from "@/components/admin-format";

type AiSettingsForm = { -readonly [K in keyof AiSettings]: AiSettings[K] };

export function AiAssistantCard({ ai }: { ai: AiSettings & { quota: AiQuota } }) {
  const [form, setForm] = useState<AiSettingsForm>({
    enabled: ai.enabled,
    personaName: ai.personaName,
    extraInstructions: ai.extraInstructions,
    autoResumeMinutes: ai.autoResumeMinutes,
    allowOverage: ai.allowOverage,
    monthlyHardCap: ai.monthlyHardCap,
    autoConfirmOrders: ai.autoConfirmOrders,
  });
  const [raw, setRaw] = useState({
    autoResumeMinutes: String(ai.autoResumeMinutes),
    monthlyHardCap: String(ai.monthlyHardCap),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof AiSettingsForm>(k: K, v: AiSettingsForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const numbers: Record<string, number> = {};
    const invalid: Record<string, string> = {};
    for (const [key, text] of Object.entries(raw)) {
      const value = Number(text);
      if (text.trim() === "" || !Number.isInteger(value)) invalid[key] = "Informe um número inteiro.";
      else numbers[key] = value;
    }
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }
    start(async () => {
      const r = await saveAiSettingsAction({ ...form, ...numbers });
      if (r.ok) {
        setErrors({});
        toast.success("Atendente IA salvo.");
      } else {
        setErrors(r.error.fieldErrors ?? {});
        toast.error(r.error.message);
      }
    });
  };

  const fieldError = (name: string) =>
    errors[name] ? (
      <p role="alert" className="text-xs text-red-600 dark:text-red-300">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={save} className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Atendente IA</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A IA responde no WhatsApp, anota o pedido, pergunta se é retirada ou entrega e pede o endereço. O cliente
            confirma o resumo antes de o pedido ser criado.
          </p>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} aria-label="Ativar Atendente IA" />
      </div>

      {form.enabled && (
        <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
          Com a IA ativa, as mensagens dos clientes, o nome e o endereço são processados pela Anthropic para gerar as
          respostas.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="ai-persona">Nome da atendente</Label>
        <Input
          id="ai-persona"
          value={form.personaName}
          maxLength={40}
          onChange={(e) => set("personaName", e.target.value)}
        />
        {fieldError("personaName")}
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-extra">Instruções extras</Label>
        <Textarea
          id="ai-extra"
          value={form.extraInstructions ?? ""}
          maxLength={1000}
          placeholder="Ex.: Avise que a marmita grande serve duas pessoas."
          onChange={(e) => set("extraInstructions", e.target.value || null)}
        />
        {fieldError("extraInstructions")}
      </div>

      <div className="space-y-2">
        <Label htmlFor="ai-resume">Retomar a IA depois de uma resposta da equipe (minutos, 0 = nunca)</Label>
        <Input
          id="ai-resume"
          type="number"
          min={0}
          max={10080}
          value={raw.autoResumeMinutes}
          onChange={(e) => setRaw((r) => ({ ...r, autoResumeMinutes: e.target.value }))}
        />
        {fieldError("autoResumeMinutes")}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3 text-sm">
        <div>
          <p className="font-medium">Confirmar pedidos da IA automaticamente</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O pedido entra como confirmado e o cliente recebe a mensagem de confirmação. Desligado, o pedido fica
            aguardando até a equipe confirmar.
          </p>
        </div>
        <Switch
          checked={form.autoConfirmOrders}
          onCheckedChange={(v) => set("autoConfirmOrders", v)}
          aria-label="Confirmar pedidos da IA automaticamente"
        />
      </div>

      <div className="space-y-3 rounded-md border border-border p-3 text-sm">
        <p className="font-medium">
          Respostas da IA este mês: {ai.quota.used.toLocaleString("pt-BR")} de{" "}
          {ai.quota.included.toLocaleString("pt-BR")} incluídas
        </p>
        <div className="flex items-center justify-between gap-4">
          <span>Continuar e pagar pelo uso ({formatBRL(ai.quota.pricePer100Cents)} a cada 100 respostas extras)</span>
          <Switch
            checked={form.allowOverage}
            onCheckedChange={(v) => set("allowOverage", v)}
            aria-label="Continuar e pagar pelo uso"
          />
        </div>
        {!form.allowOverage && (
          <p className="text-xs text-muted-foreground">
            Sem isso, a IA para ao atingir o limite e as conversas vão para a equipe.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="ai-cap" className="text-xs">
            Limite máximo de respostas no mês
          </Label>
          <Input
            id="ai-cap"
            type="number"
            min={1}
            max={1000000}
            value={raw.monthlyHardCap}
            onChange={(e) => setRaw((r) => ({ ...r, monthlyHardCap: e.target.value }))}
          />
          {fieldError("monthlyHardCap")}
        </div>
      </div>

      <Button type="submit" disabled={pending} className="gap-2">
        <Save className="h-4 w-4" />
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
