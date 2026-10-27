"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, Check, Clock3, Copy, CreditCard, KeyRound, Link2, MessageSquareText, Receipt, Save, Settings2 } from "lucide-react";
import type { AiQuota, AiSettings, ApiKeyListItem, PlanAndUsage, SettingsView, UatisWebhookStatus, WebhookDeliveryView } from "@mt/http";
import { TEMPLATE_MESSAGE_KINDS } from "@mt/schemas";
import { Button } from "@mt/ui/components/button";
import { Input } from "@mt/ui/components/input";
import { Label } from "@mt/ui/components/label";
import { Switch } from "@mt/ui/components/switch";
import { Textarea } from "@mt/ui/components/textarea";
import { cn } from "@mt/ui/lib/utils";

import {
  canRedeliver,
  centsToInput,
  deliveryStatusLabel,
  formatBRL,
  parseBRLToCents,
  uatisModeExplanation,
  uatisModeLabel,
  uatisNextModeText,
  usagePercent,
  WEEKDAY_NAMES,
  WEEKDAY_ORDER,
} from "@/components/admin-format";
import {
  connectWhatsAppAction,
  createApiKeyAction,
  disableUatisWebhookAction,
  disconnectWhatsAppAction,
  enableUatisWebhookAction,
  redeliverWebhookAction,
  revokeApiKeyAction,
  rotateWebhookSecretAction,
  saveAutomaticMessageAction,
  saveBusinessHoursAction,
  saveFiscalConfigAction,
  saveOrderPreferencesAction,
  saveProfileAction,
  saveWebhookEndpointAction,
  testFiscalConnectionAction,
  testWhatsAppConnectionAction,
} from "@/app/(app)/settings/actions";
import { AiAssistantCard } from "@/components/ai-assistant-card";
import type { ActionResult } from "@/lib/server/action-core";

const tabs = [
  { id: "restaurant", label: "Restaurante", icon: Settings2 },
  { id: "hours", label: "Horários", icon: Clock3 },
  { id: "messages", label: "Mensagens automáticas", icon: MessageSquareText },
  { id: "integrations", label: "WhatsApp, webhook e API", icon: Link2 },
  { id: "fiscal", label: "Notas fiscais", icon: Receipt },
  { id: "ai", label: "Atendente IA", icon: Bot },
  { id: "plan", label: "Plano", icon: CreditCard },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsPage({
  settings,
  plan,
  deliveries = [],
  ai,
  uatisWebhook = null,
}: {
  settings: SettingsView;
  plan: PlanAndUsage;
  deliveries?: WebhookDeliveryView[];
  ai: AiSettings & { quota: AiQuota };
  uatisWebhook?: UatisWebhookStatus | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("restaurant");

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Administração</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure o funcionamento do seu restaurante e suas automações.</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 border-r border-border bg-card p-4">
          <nav className="space-y-1" aria-label="Configurações">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    activeTab === tab.id
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            {activeTab === "restaurant" && <RestaurantSettings settings={settings} />}
            {activeTab === "hours" && <HoursSettings settings={settings} />}
            {activeTab === "messages" && <AutomationSettings settings={settings} />}
            {activeTab === "integrations" && (
              <IntegrationSettings settings={settings} deliveries={deliveries} uatisWebhook={uatisWebhook} />
            )}
            {activeTab === "fiscal" && <FiscalSettings settings={settings} />}
            {activeTab === "ai" && <AiAssistantCard ai={ai} />}
            {activeTab === "plan" && <PlanSettings plan={plan} />}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

type Errors = Record<string, string>;

/** Runs a Server Action, toasts the outcome, and keeps field errors (FR-095). */
function useSection() {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  function run<T>(call: () => Promise<ActionResult<T>>, success: string | ((data: T) => string | null), onOk?: (data: T) => void) {
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        setErrors({});
        const message = typeof success === "function" ? success(result.data) : success;
        if (message) toast.success(message);
        onOk?.(result.data);
      } else {
        setErrors(result.error.fieldErrors ?? {});
        toast.error(result.error.message);
      }
    });
  }
  return { pending, errors, run };
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, error, className, children }: { label: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function SaveButton({ pending, label = "Salvar" }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      <Save className="h-4 w-4" />
      {pending ? "Salvando…" : label}
    </Button>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

/** Write-only secret input: shows "configurado" and the last four characters, never the value (FR-094). */
function SecretField({
  label,
  state,
  value,
  onChange,
  error,
}: {
  label: string;
  state: { configured: boolean; last4: string } | undefined;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field label={label} error={error}>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          state?.configured
            ? `Configurado${state.last4 ? ` (final ${state.last4})` : ""}. Deixe em branco para manter.`
            : "Cole o valor aqui"
        }
      />
    </Field>
  );
}

function StatusBadge({ status, lastError }: { status: "disconnected" | "connected" | "error"; lastError: string | null }) {
  const label = status === "connected" ? "Conectado" : status === "error" ? "Erro na conexão" : "Não testado";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={cn(
          "rounded-full px-2 py-1 font-semibold",
          status === "connected" && "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300",
          status === "error" && "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
          status === "disconnected" && "bg-muted text-muted-foreground",
        )}
      >
        {label}
      </span>
      {lastError && <span className="text-red-600 dark:text-red-300">{lastError}</span>}
    </div>
  );
}

/** A value shown once. The component holds it in memory only; closing it discards it. */
function ShownOnce({ title, value, onClose }: { title: string; value: string; onClose: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }
  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4" role="status">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">{title}</p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Copie agora. Este valor não será exibido novamente.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-card px-2 py-1.5 text-xs text-foreground">{value}</code>
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={copy}>
          <Copy className="h-3.5 w-3.5" />
          Copiar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <Check className="h-3.5 w-3.5" />
          Já copiei
        </Button>
      </div>
    </div>
  );
}

// ─── Restaurante (FR-080..FR-082, FR-096) ─────────────────────────────────────

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
];

function RestaurantSettings({ settings }: { settings: SettingsView }) {
  const p = settings.profile;
  const [profile, setProfile] = useState({
    name: p.name,
    phone: p.phone ?? "",
    email: p.email ?? "",
    address: p.address ?? "",
    cidade: p.cidade ?? "",
    uf: p.uf ?? "",
    codigoMunicipio: p.codigoMunicipio ?? "",
  });
  const profileSection = useSection();

  const pr = settings.preferences;
  const [prefs, setPrefs] = useState({
    autoAccept: pr.autoAccept,
    pickupEnabled: pr.pickupEnabled,
    showDeliveryEstimate: pr.showDeliveryEstimate,
    fee: centsToInput(pr.deliveryFeeCents),
    minutes: String(pr.deliveryEstimateMinutes),
    timezone: pr.timezone,
  });
  const prefSection = useSection();
  const [feeError, setFeeError] = useState<string | null>(null);

  const set = (key: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile((prev) => ({ ...prev, [key]: e.target.value }));

  function savePrefs(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseBRLToCents(prefs.fee);
    if (cents === null) {
      setFeeError("Informe um valor válido, por exemplo 6,00.");
      return;
    }
    setFeeError(null);
    prefSection.run(
      () =>
        saveOrderPreferencesAction({
          autoAccept: prefs.autoAccept,
          pickupEnabled: prefs.pickupEnabled,
          showDeliveryEstimate: prefs.showDeliveryEstimate,
          deliveryFeeCents: cents,
          deliveryEstimateMinutes: Number(prefs.minutes),
          timezone: prefs.timezone,
        }),
      "Preferências salvas.",
    );
  }

  const timezones = TIMEZONES.includes(prefs.timezone) ? TIMEZONES : [prefs.timezone, ...TIMEZONES];

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          profileSection.run(() => saveProfileAction(profile), "Dados do restaurante salvos.");
        }}
      >
        <Card title="Dados do restaurante" description="Essas informações aparecem para seus clientes.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do restaurante" className="sm:col-span-2" error={profileSection.errors.name}>
              <Input value={profile.name} onChange={set("name")} />
            </Field>
            <Field label="Telefone" error={profileSection.errors.phone}>
              <Input value={profile.phone} onChange={set("phone")} />
            </Field>
            <Field label="E-mail" error={profileSection.errors.email}>
              <Input value={profile.email} onChange={set("email")} />
            </Field>
            <Field label="Endereço" className="sm:col-span-2" error={profileSection.errors.address}>
              <Input value={profile.address} onChange={set("address")} />
            </Field>
            <Field label="Cidade" error={profileSection.errors.cidade}>
              <Input value={profile.cidade} onChange={set("cidade")} />
            </Field>
            <Field label="UF" error={profileSection.errors.uf}>
              <Input value={profile.uf} onChange={set("uf")} maxLength={2} />
            </Field>
            <Field label="Código do município (IBGE)" className="sm:col-span-2" error={profileSection.errors.codigoMunicipio}>
              <Input value={profile.codigoMunicipio} onChange={set("codigoMunicipio")} inputMode="numeric" maxLength={7} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <SaveButton pending={profileSection.pending} />
          </div>
        </Card>
      </form>

      <form onSubmit={savePrefs}>
        <Card title="Preferências de pedidos">
          <div className="space-y-4">
            <ToggleRow
              title="Aceitar pedidos automaticamente"
              description="Novos pedidos entram diretamente como confirmados."
              checked={prefs.autoAccept}
              onChange={(autoAccept) => setPrefs((prev) => ({ ...prev, autoAccept }))}
            />
            <ToggleRow
              title="Permitir pedidos para retirada"
              description="Clientes podem escolher retirar no restaurante."
              checked={prefs.pickupEnabled}
              onChange={(pickupEnabled) => setPrefs((prev) => ({ ...prev, pickupEnabled }))}
            />
            <ToggleRow
              title="Exibir estimativa de entrega"
              description="Mostra o tempo estimado durante o pedido."
              checked={prefs.showDeliveryEstimate}
              onChange={(showDeliveryEstimate) => setPrefs((prev) => ({ ...prev, showDeliveryEstimate }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Taxa de entrega (R$)" error={feeError ?? prefSection.errors.deliveryFeeCents}>
                <Input value={prefs.fee} onChange={(e) => setPrefs((prev) => ({ ...prev, fee: e.target.value }))} inputMode="decimal" />
              </Field>
              <Field label="Estimativa de entrega (min)" error={prefSection.errors.deliveryEstimateMinutes}>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  value={prefs.minutes}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, minutes: e.target.value }))}
                />
              </Field>
              <Field label="Fuso horário" error={prefSection.errors.timezone}>
                <select
                  value={prefs.timezone}
                  onChange={(e) => setPrefs((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <SaveButton pending={prefSection.pending} />
          </div>
        </Card>
      </form>
    </div>
  );
}

// ─── Horários (FR-083) ────────────────────────────────────────────────────────

function HoursSettings({ settings }: { settings: SettingsView }) {
  const [days, setDays] = useState(settings.hours);
  const section = useSection();
  const update = (weekday: number, patch: Partial<(typeof days)[number]>) =>
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        // Sent in weekday order, so `days.N` in a field error is weekday N.
        section.run(
          () => saveBusinessHoursAction({ days: [...days].sort((a, b) => a.weekday - b.weekday) }),
          "Horários salvos.",
        );
      }}
    >
      <Card
        title="Horário de funcionamento"
        description="Defina quando o restaurante aceita pedidos. Se o fechamento for antes da abertura, o horário termina no dia seguinte."
      >
        <div className="space-y-2">
          {WEEKDAY_ORDER.map((weekday) => {
            const value = days.find((d) => d.weekday === weekday);
            if (!value) return null;
            const name = WEEKDAY_NAMES[weekday];
            const error = section.errors[`days.${weekday}.closesAt`] ?? section.errors[`days.${weekday}.opensAt`];
            return (
              <div key={weekday}>
                <div className="grid grid-cols-[110px_1fr_110px_110px] items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={value.enabled} onCheckedChange={(enabled) => update(weekday, { enabled })} aria-label={name} />
                    <span className="text-sm font-medium">{name}</span>
                  </div>
                  <span className={cn("text-xs", value.enabled ? "text-green-600 dark:text-green-300" : "text-muted-foreground")}>
                    {value.enabled ? "Aberto" : "Fechado"}
                  </span>
                  <Input
                    type="time"
                    aria-label={`${name}: abre às`}
                    value={value.opensAt}
                    disabled={!value.enabled}
                    onChange={(e) => update(weekday, { opensAt: e.target.value })}
                  />
                  <Input
                    type="time"
                    aria-label={`${name}: fecha às`}
                    value={value.closesAt}
                    disabled={!value.enabled}
                    onChange={(e) => update(weekday, { closesAt: e.target.value })}
                  />
                </div>
                {error && (
                  <p role="alert" className="mt-1 px-1 text-xs text-red-600 dark:text-red-300">
                    {name}: {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <SaveButton pending={section.pending} />
        </div>
      </Card>
    </form>
  );
}

// ─── Mensagens automáticas (FR-084, FR-200, ADR-014, ADR-026, ADR-028) ────────

const MESSAGE_COPY = {
  welcome: { title: "Mensagem de boas-vindas", description: "Enviada quando um novo cliente inicia uma conversa." },
  closed: { title: "Fora do horário", description: "Enviada automaticamente quando o restaurante está fechado." },
  order_received: { title: "Pedido recebido", description: "Confirma o recebimento de um novo pedido." },
  order_confirmed: { title: "Pedido confirmado", description: "Enviada quando o pedido é confirmado." },
  order_ready: {
    title: "Pedido pronto para retirada",
    description: "Enviada quando o pedido fica pronto. Só para pedidos de retirada.",
  },
  order_out_for_delivery: { title: "Saiu para entrega", description: "Enviada quando o pedido sai para entrega." },
  order_cancelled: { title: "Pedido cancelado", description: "Enviada quando o pedido é cancelado." },
} as const;

function AutomationSettings({ settings }: { settings: SettingsView }) {
  return (
    <div className="space-y-5">
      <Card title="Respostas automáticas" description="Personalize as mensagens que serão enviadas sem intervenção manual.">
        <div className="space-y-3">
          {settings.automaticMessages.map((message) => (
            <AutomaticMessageCard key={message.kind} message={message} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function AutomaticMessageCard({ message }: { message: SettingsView["automaticMessages"][number] }) {
  const copy = MESSAGE_COPY[message.kind];
  const usesTemplate = TEMPLATE_MESSAGE_KINDS.includes(message.kind);
  const [enabled, setEnabled] = useState(message.enabled);
  const [body, setBody] = useState(message.body);
  const [templateName, setTemplateName] = useState(message.templateName ?? "");
  const [templateLanguage, setTemplateLanguage] = useState(message.templateLanguage ?? "");
  const section = useSection();

  return (
    <form
      className="rounded-lg border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        section.run(
          () =>
            saveAutomaticMessageAction({
              kind: message.kind,
              enabled,
              body,
              ...(usesTemplate ? { templateName, templateLanguage } : {}),
            }),
          `${copy.title} salva.`,
        );
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-foreground">{copy.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={copy.title} />
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="mt-3 min-h-20 text-sm" aria-label={`Texto: ${copy.title}`} />
      {section.errors.body && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-300">{section.errors.body}</p>}
      {usesTemplate && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Modelo do WhatsApp (opcional)" error={section.errors.templateName}>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="nome_do_modelo" />
          </Field>
          <Field label="Idioma do modelo" error={section.errors.templateLanguage}>
            <Input value={templateLanguage} onChange={(e) => setTemplateLanguage(e.target.value)} placeholder="pt_BR" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Fora da janela de 24 horas, o WhatsApp só aceita modelos aprovados. Informe o nome e o idioma de um modelo aprovado.
          </p>
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <SaveButton pending={section.pending} />
      </div>
    </form>
  );
}

// ─── WhatsApp, webhook e API (FR-085..FR-089, FR-094) ─────────────────────────

function IntegrationSettings({
  settings,
  deliveries,
  uatisWebhook,
}: {
  settings: SettingsView;
  deliveries: WebhookDeliveryView[];
  uatisWebhook: UatisWebhookStatus | null;
}) {
  return (
    <div className="space-y-5">
      <WhatsAppCard state={settings.integrations.whatsapp} />
      {settings.integrations.whatsapp && <UatisWebhookPanel status={uatisWebhook} />}
      <WebhookCard state={settings.integrations.webhook} />
      {settings.integrations.webhook && <WebhookDeliveriesCard deliveries={deliveries} />}
      <ApiKeysCard keys={settings.integrations.apiKeys} />
    </div>
  );
}

function WhatsAppCard({ state }: { state: SettingsView["integrations"]["whatsapp"] }) {
  const [form, setForm] = useState({
    baseUrl: state?.baseUrl ?? "",
    phoneNumberId: state?.phoneNumberId ?? "",
    apiKey: "",
    webhookSecret: "",
  });
  const section = useSection();
  const connected = state !== null;
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    section.run(
      () =>
        connectWhatsAppAction({
          baseUrl: form.baseUrl,
          phoneNumberId: form.phoneNumberId,
          // Left blank means "keep the stored secret". Never sent as an empty string.
          ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
          ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret } : {}),
        }),
      (r) => (r.status === "connected" ? "WhatsApp conectado." : null),
      (r) => {
        setForm((prev) => ({ ...prev, apiKey: "", webhookSecret: "" }));
        if (r.status !== "connected") toast.error(r.lastError ?? "Não foi possível conectar.");
      },
    );
  }

  return (
    <form onSubmit={submit}>
      <Card title="WhatsApp (backend-uatis)" description="Canal de mensagens. As chaves são guardadas cifradas e nunca voltam para esta tela.">
        <div className="space-y-4">
          {state && <StatusBadge status={state.status} lastError={state.lastError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="URL do backend-uatis" className="sm:col-span-2" error={section.errors.baseUrl}>
              <Input value={form.baseUrl} onChange={(e) => set("baseUrl")(e.target.value)} placeholder="https://uatis.exemplo.com" />
            </Field>
            <Field label="ID do número (phone_number_id)" className="sm:col-span-2" error={section.errors.phoneNumberId}>
              <Input value={form.phoneNumberId} onChange={(e) => set("phoneNumberId")(e.target.value)} />
            </Field>
            <SecretField label="Chave de API" state={state?.apiKey} value={form.apiKey} onChange={set("apiKey")} error={section.errors.apiKey} />
            <SecretField
              label="Segredo do webhook (opcional)"
              state={state?.webhookSecret}
              value={form.webhookSecret}
              onChange={set("webhookSecret")}
              error={section.errors.webhookSecret}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {connected && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={section.pending}
                  onClick={() =>
                    section.run(
                      () => testWhatsAppConnectionAction(undefined),
                      (r) => (r.status === "connected" ? "Conexão funcionando." : null),
                      (r) => {
                        if (r.status !== "connected") toast.error(r.lastError ?? "A conexão falhou.");
                      },
                    )
                  }
                >
                  Testar conexão
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={section.pending}
                  onClick={() => {
                    if (window.confirm("Desconectar o WhatsApp? As chaves guardadas serão apagadas.")) {
                      section.run(() => disconnectWhatsAppAction(undefined), "WhatsApp desconectado.", () =>
                        setForm({ baseUrl: "", phoneNumberId: "", apiKey: "", webhookSecret: "" }),
                      );
                    }
                  }}
                >
                  Desconectar
                </Button>
              </>
            )}
            <SaveButton pending={section.pending} label={connected ? "Salvar e testar" : "Conectar"} />
          </div>
        </div>
      </Card>
    </form>
  );
}

const UATIS_EVENT_LABELS: Record<string, string> = {
  "message.created": "Mensagem criada",
  "message.updated": "Mensagem atualizada",
  "conversation.updated": "Conversa atualizada",
};

/** FR-170..FR-173, FR-178 (ADR-021, ADR-023): the backend-uatis webhook, push or pull. */
function UatisWebhookPanel({ status }: { status: UatisWebhookStatus | null }) {
  const section = useSection();
  if (status === null) {
    return (
      <Card title="Webhook do backend-uatis">
        <p className="text-sm text-muted-foreground">Não foi possível ler o estado do webhook.</p>
      </Card>
    );
  }
  const active = status.state === "active";
  return (
    <Card
      title="Webhook do backend-uatis"
      description="Recebe as mensagens e as confirmações de entrega e leitura do WhatsApp em poucos segundos."
    >
      <div className="space-y-4" data-testid="uatis-webhook-panel">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              "rounded-full px-2 py-1 text-xs font-semibold",
              active ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300" : "bg-muted text-muted-foreground",
            )}
          >
            {active ? "Ativo" : "Não registrado"}
          </span>
          {active && status.mode && (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
              {uatisModeLabel(status.mode)}
            </span>
          )}
          <span className="text-muted-foreground">
            Último recebimento por push: {status.lastWebhookAt ? formatWhen(status.lastWebhookAt) : "nenhum"}
            {" · "}
            Última leitura: {status.lastSyncedAt ? formatWhen(status.lastSyncedAt) : "nenhuma"}
          </span>
        </div>
        {active && status.mode ? (
          <p className="text-sm text-muted-foreground">{uatisModeExplanation(status.mode)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem webhook, o Marmitop consulta as mensagens recebidas a cada 30 segundos e não recebe as confirmações de entrega e leitura.
          </p>
        )}
        <p className="text-sm text-muted-foreground">{uatisNextModeText(status)}</p>
        {active && (
          <div>
            <Label>Últimas entregas no backend-uatis</Label>
            {status.deliveriesError ? (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{status.deliveriesError}</p>
            ) : !status.deliveries || status.deliveries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma entrega ainda.</p>
            ) : (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Evento</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">HTTP</th>
                      <th className="py-2 pr-3 font-medium">Tentativa</th>
                      <th className="py-2 font-medium">Criada em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.deliveries.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3">{UATIS_EVENT_LABELS[d.eventType] ?? d.eventType}</td>
                        <td className="py-2 pr-3">{deliveryStatusLabel(d.status)}</td>
                        <td className="py-2 pr-3">{d.httpStatus ?? "—"}</td>
                        <td className="py-2 pr-3">{d.attemptNo}</td>
                        <td className="py-2">{formatWhen(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {active && (
            <Button
              type="button"
              variant="outline"
              disabled={section.pending}
              onClick={() => {
                if (window.confirm("Desativar o webhook? O Marmitop volta a consultar as mensagens a cada 30 segundos.")) {
                  section.run(
                    () => disableUatisWebhookAction(undefined),
                    (r) => (r.ok ? "Webhook desativado." : null),
                    (r) => {
                      if (!r.ok) toast.error(r.error);
                    },
                  );
                }
              }}
            >
              Desativar webhook
            </Button>
          )}
          <Button
            type="button"
            disabled={section.pending}
            onClick={() =>
              section.run(
                () => enableUatisWebhookAction(undefined),
                (r) => (r.ok ? `Webhook ativado (${uatisModeLabel(r.mode)}).` : null),
                (r) => {
                  if (!r.ok) toast.error(r.error);
                },
              )
            }
          >
            {active ? "Registrar novamente" : "Ativar webhook"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

const EVENT_LABELS: Record<string, string> = {
  "order.created": "Pedido criado",
  "order.status_changed": "Status do pedido alterado",
  "message.received": "Mensagem recebida",
  "invoice.updated": "Nota fiscal atualizada",
};

function WebhookCard({ state }: { state: SettingsView["integrations"]["webhook"] }) {
  const [url, setUrl] = useState(state?.url ?? "");
  const [events, setEvents] = useState<string[]>(state?.events ?? Object.keys(EVENT_LABELS));
  const [enabled, setEnabled] = useState(state?.enabled ?? true);
  const [shown, setShown] = useState<string | null>(null);
  const section = useSection();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        section.run(
          () => saveWebhookEndpointAction({ url, events, enabled }),
          "Webhook salvo.",
          (r) => {
            if (r.secret) setShown(r.secret);
          },
        );
      }}
    >
      <Card title="Webhook de saída" description="Enviamos os eventos escolhidos para esta URL, assinados com HMAC-SHA256.">
        <div className="space-y-4">
          {shown && <ShownOnce title="Segredo de assinatura do webhook" value={shown} onClose={() => setShown(null)} />}
          <Field label="URL do webhook" error={section.errors.url}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seu-sistema.com/webhooks/marmitop" />
          </Field>
          <div className="space-y-2">
            <Label>Eventos</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(EVENT_LABELS).map(([event, label]) => (
                <label key={event} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={(e) => setEvents((prev) => (e.target.checked ? [...prev, event] : prev.filter((x) => x !== event)))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {section.errors.events && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{section.errors.events}</p>}
          </div>
          <ToggleRow title="Webhook ativo" description="Desative para pausar os envios sem apagar a configuração." checked={enabled} onChange={setEnabled} />
          {state && (
            <p className="text-xs text-muted-foreground">
              Segredo de assinatura: configurado{state.secret.last4 ? ` (final ${state.secret.last4})` : ""}.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {state && (
              <Button
                type="button"
                variant="outline"
                disabled={section.pending}
                onClick={() => {
                  if (window.confirm("Gerar um novo segredo? O segredo atual deixa de valer.")) {
                    section.run(
                      () => rotateWebhookSecretAction(undefined),
                      "Novo segredo gerado.",
                      (r) => setShown(r.secret),
                    );
                  }
                }}
              >
                Gerar novo segredo
              </Button>
            )}
            <SaveButton pending={section.pending} />
          </div>
        </div>
      </Card>
    </form>
  );
}

/** FR-149: recent deliveries with event, status, attempts, last status code, and "Reenviar". */
function WebhookDeliveriesCard({ deliveries }: { deliveries: WebhookDeliveryView[] }) {
  const section = useSection();
  return (
    <Card title="Entregas recentes" description="As últimas entregas do webhook. Falhas são reenviadas em 1 min, 5 min, 30 min, 2 h e 8 h.">
      {deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma entrega ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Evento</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Tentativas</th>
                <th className="py-2 pr-3 font-medium">Última resposta</th>
                <th className="py-2 pr-3 font-medium">Criada em</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">{EVENT_LABELS[d.event] ?? d.event}</td>
                  <td className="py-2 pr-3">{deliveryStatusLabel(d.status)}</td>
                  <td className="py-2 pr-3">{d.attempts}</td>
                  <td className="py-2 pr-3">{d.lastStatusCode ?? d.lastError ?? "—"}</td>
                  <td className="py-2 pr-3">{formatWhen(d.createdAt)}</td>
                  <td className="py-2 text-right">
                    {canRedeliver(d.status) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={section.pending}
                        onClick={() => section.run(() => redeliverWebhookAction({ deliveryId: d.id }), "Entrega reenviada.")}
                      >
                        Reenviar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function ApiKeysCard({ keys }: { keys: ApiKeyListItem[] }) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [shown, setShown] = useState<string | null>(null);
  const section = useSection();

  return (
    <Card title="Chaves de API" description="Use uma chave para chamar a API pública. A chave completa aparece uma única vez.">
      <div className="space-y-4">
        {shown && <ShownOnce title="Nova chave de API" value={shown} onClose={() => setShown(null)} />}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            section.run(
              () => createApiKeyAction({ name, environment }),
              "Chave criada.",
              (r) => {
                setShown(r.key);
                setName("");
              },
            );
          }}
        >
          <Field label="Nome da chave" error={section.errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Integração com o ERP" />
          </Field>
          <Field label="Ambiente" error={section.errors.environment}>
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as "live" | "test")}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="live">live</option>
              <option value="test">test</option>
            </select>
          </Field>
          <Button type="submit" disabled={section.pending} className="gap-2">
            <KeyRound className="h-4 w-4" />
            Criar chave
          </Button>
        </form>

        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma chave criada.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className={cn("text-sm font-medium", key.revokedAt && "text-muted-foreground line-through")}>{key.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <code>{key.prefix}…</code> · {key.environment} · último uso: {formatWhen(key.lastUsedAt)}
                  </p>
                </div>
                {key.revokedAt ? (
                  <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">Revogada</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={section.pending}
                    onClick={() => {
                      if (window.confirm(`Revogar a chave "${key.name}"? Quem a usa perde o acesso.`)) {
                        section.run(() => revokeApiKeyAction({ id: key.id }), "Chave revogada.");
                      }
                    }}
                  >
                    Revogar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Notas fiscais (FR-090, FR-091) ───────────────────────────────────────────

function FiscalSettings({ settings }: { settings: SettingsView }) {
  const state = settings.integrations.fiscal;
  const [form, setForm] = useState({
    baseUrl: state?.baseUrl ?? "",
    apiKey: "",
    webhookSecret: "",
    environment: state?.environment ?? "homologacao",
    nfceSerie: String(state?.nfceSerie ?? 1),
    nfeSerie: String(state?.nfeSerie ?? 1),
    ncm: state?.defaults.ncm ?? "",
    cfop: state?.defaults.cfop ?? "",
    csosn: state?.defaults.csosn ?? "",
    pisCst: state?.defaults.pisCst ?? "",
    cofinsCst: state?.defaults.cofinsCst ?? "",
    deliveryFeeMode: state?.deliveryFeeMode ?? "item",
  });
  const section = useSection();
  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const text = (key: keyof typeof form) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key)(e.target.value) });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        section.run(
          () =>
            saveFiscalConfigAction({
              baseUrl: form.baseUrl,
              environment: form.environment,
              nfceSerie: Number(form.nfceSerie),
              nfeSerie: Number(form.nfeSerie),
              defaults: { ncm: form.ncm, cfop: form.cfop, csosn: form.csosn, pisCst: form.pisCst, cofinsCst: form.cofinsCst },
              deliveryFeeMode: form.deliveryFeeMode,
              ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
              ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret } : {}),
            }),
          "Configuração fiscal salva.",
          () => setForm((prev) => ({ ...prev, apiKey: "", webhookSecret: "" })),
        );
      }}
    >
      <Card title="Notas fiscais (web-nf)" description="Dados para emitir NFC-e e NF-e. As chaves são guardadas cifradas e nunca voltam para esta tela.">
        <div className="space-y-4">
          {state && <StatusBadge status={state.status} lastError={state.lastError} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="URL do web-nf" className="sm:col-span-2" error={section.errors.baseUrl}>
              <Input {...text("baseUrl")} placeholder="https://webnf.exemplo.com" />
            </Field>
            <SecretField label="Chave de API" state={state?.apiKey} value={form.apiKey} onChange={set("apiKey")} error={section.errors.apiKey} />
            <SecretField
              label="Segredo do webhook (opcional)"
              state={state?.webhookSecret}
              value={form.webhookSecret}
              onChange={set("webhookSecret")}
              error={section.errors.webhookSecret}
            />
            <Field label="Ambiente" error={section.errors.environment}>
              <select
                value={form.environment}
                onChange={(e) => set("environment")(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="homologacao">Homologação</option>
                <option value="producao">Produção</option>
              </select>
            </Field>
            <Field label="Taxa de entrega na nota" error={section.errors.deliveryFeeMode}>
              <select
                value={form.deliveryFeeMode}
                onChange={(e) => set("deliveryFeeMode")(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="item">Como item da nota</option>
                <option value="none">Não incluir</option>
              </select>
            </Field>
            <Field label="Série NFC-e" error={section.errors.nfceSerie}>
              <Input type="number" min={1} max={999} {...text("nfceSerie")} />
            </Field>
            <Field label="Série NF-e" error={section.errors.nfeSerie}>
              <Input type="number" min={1} max={999} {...text("nfeSerie")} />
            </Field>
            <Field label="NCM padrão" error={section.errors["defaults.ncm"]}>
              <Input {...text("ncm")} maxLength={8} inputMode="numeric" />
            </Field>
            <Field label="CFOP padrão" error={section.errors["defaults.cfop"]}>
              <Input {...text("cfop")} maxLength={4} inputMode="numeric" />
            </Field>
            <Field label="CSOSN padrão" error={section.errors["defaults.csosn"]}>
              <Input {...text("csosn")} maxLength={3} inputMode="numeric" />
            </Field>
            <Field label="CST do PIS" error={section.errors["defaults.pisCst"]}>
              <Input {...text("pisCst")} maxLength={2} inputMode="numeric" />
            </Field>
            <Field label="CST da COFINS" error={section.errors["defaults.cofinsCst"]}>
              <Input {...text("cofinsCst")} maxLength={2} inputMode="numeric" />
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {state && (
              <Button
                type="button"
                variant="outline"
                disabled={section.pending}
                onClick={() =>
                  section.run(
                    () => testFiscalConnectionAction(undefined),
                    (r) => (r.status === "connected" ? "Conexão funcionando." : null),
                    (r) => {
                      if (r.status !== "connected") toast.error(r.lastError ?? "A conexão falhou.");
                    },
                  )
                }
              >
                Testar conexão
              </Button>
            )}
            <SaveButton pending={section.pending} />
          </div>
        </div>
      </Card>
    </form>
  );
}

// ─── Plano (FR-092, FR-093, FR-154, FR-155) ───────────────────────────────────

function UsageRow({ label, used, included }: { label: string; used: number; included: number }) {
  const pct = usagePercent(used, included);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString("pt-BR")} de {included.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-red-500" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PlanSettings({ plan }: { plan: PlanAndUsage }) {
  return (
    <div className="space-y-5">
      <Card title="Plano atual">
        <div className="flex items-baseline justify-between">
          <p className="text-xl font-bold text-foreground">{plan.plan?.name ?? "Sem plano"}</p>
          {plan.plan?.priceDisplay && <p className="text-sm text-muted-foreground">{plan.plan.priceDisplay}</p>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Os limites são informativos, exceto as respostas da IA.</p>
      </Card>
      <Card title="Uso do mês">
        <div className="space-y-4">
          <UsageRow label="Pedidos" used={plan.usage.orders.used} included={plan.usage.orders.included} />
          <UsageRow label="Mensagens enviadas" used={plan.usage.messages.used} included={plan.usage.messages.included} />
          <UsageRow label="Notas fiscais emitidas" used={plan.usage.invoices.used} included={plan.usage.invoices.included} />
          <UsageRow label="Respostas da IA" used={plan.usage.aiReplies.used} included={plan.usage.aiReplies.included} />
          {plan.usage.aiReplies.allowOverage && plan.usage.aiReplies.extra > 0 && (
            <p className="text-sm text-muted-foreground">
              {plan.usage.aiReplies.extra.toLocaleString("pt-BR")} respostas extras ·{" "}
              {formatBRL(plan.usage.aiReplies.amountCents)} a pagar pelo uso
            </p>
          )}
        </div>
      </Card>
      <Card title="Histórico de faturas">
        {plan.invoiceHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma fatura ainda. A cobrança não está ativa nesta versão.</p>
        ) : (
          <ul className="space-y-2">
            {plan.invoiceHistory.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between text-sm">
                <span>{new Date(invoice.periodStart).toLocaleDateString("pt-BR")}</span>
                <span>{formatBRL(invoice.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default SettingsPage;
