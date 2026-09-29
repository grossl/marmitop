"use client";

import { useState } from "react";
import { Bell, Bot, Check, Clock3, Link2, MessageSquareText, Plus, Save, Settings2, Trash2, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "restaurant", label: "Restaurante", icon: Settings2 },
  { id: "hours", label: "Horários", icon: Clock3 },
  { id: "messages", label: "Mensagens automáticas", icon: MessageSquareText },
  { id: "integrations", label: "Integrações e API", icon: Link2 },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("restaurant");
  const [saved, setSaved] = useState(false);
  const [days, setDays] = useState<Record<string, { enabled: boolean; open: string; close: string }>>({
    Segunda: { enabled: true, open: "08:00", close: "18:00" },
    Terça: { enabled: true, open: "08:00", close: "18:00" },
    Quarta: { enabled: true, open: "08:00", close: "18:00" },
    Quinta: { enabled: true, open: "08:00", close: "18:00" },
    Sexta: { enabled: true, open: "08:00", close: "18:00" },
    Sábado: { enabled: true, open: "09:00", close: "15:00" },
    Domingo: { enabled: false, open: "09:00", close: "14:00" },
  });
  const [automations, setAutomations] = useState([
    { id: "welcome", title: "Mensagem de boas-vindas", description: "Enviada quando um novo cliente inicia uma conversa.", enabled: true, text: "Olá! Bem-vindo à MarmitaChat. Como podemos ajudar?" },
    { id: "closed", title: "Fora do horário", description: "Enviada automaticamente quando o restaurante está fechado.", enabled: true, text: "Olá! Estamos fora do nosso horário de atendimento. Retornaremos assim que abrirmos." },
    { id: "received", title: "Pedido recebido", description: "Confirma o recebimento de um novo pedido.", enabled: true, text: "Recebemos seu pedido! Em breve confirmaremos os detalhes." },
  ]);
  const [integrations, setIntegrations] = useState([
    { id: "whatsapp", name: "WhatsApp Business", detail: "Canal de mensagens", connected: true },
    { id: "ifood", name: "iFood", detail: "Pedidos e cardápio", connected: false },
  ]);

  function saveSettings() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Administração</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Configurações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure o funcionamento do seu restaurante e suas automações.</p>
        </div>
        <Button onClick={saveSettings} className="gap-2">
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? "Salvo" : "Salvar alterações"}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 border-r border-border bg-card p-4">
          <nav className="space-y-1" aria-label="Configurações">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors", activeTab === tab.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-4 w-4" />{tab.label}</button>;
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl">
            {activeTab === "restaurant" && <RestaurantSettings />}
            {activeTab === "hours" && <HoursSettings days={days} setDays={setDays} />}
            {activeTab === "messages" && <AutomationSettings automations={automations} setAutomations={setAutomations} />}
            {activeTab === "integrations" && <IntegrationSettings integrations={integrations} setIntegrations={setIntegrations} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="mb-5"><h2 className="font-semibold text-foreground">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>{children}</div>;
}

function RestaurantSettings() {
  return <div className="space-y-5"><Card title="Dados do restaurante" description="Essas informações aparecem para seus clientes."><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label>Nome do restaurante</Label><Input defaultValue="Marmita da Casa" /></div><div className="space-y-2"><Label>Telefone</Label><Input defaultValue="(11) 99999-0000" /></div><div className="space-y-2"><Label>E-mail</Label><Input defaultValue="contato@marmitadacasa.com.br" /></div><div className="space-y-2 sm:col-span-2"><Label>Endereço</Label><Input defaultValue="Rua das Flores, 342 - Vila Madalena" /></div></div></Card><Card title="Preferências de pedidos"><div className="space-y-4"><ToggleRow title="Aceitar pedidos automaticamente" description="Novos pedidos entram diretamente como confirmados." defaultChecked /><ToggleRow title="Permitir pedidos para retirada" description="Clientes podem escolher retirar no restaurante." defaultChecked /><ToggleRow title="Exibir estimativa de entrega" description="Mostra o tempo estimado durante o pedido." defaultChecked /></div></Card></div>;
}

function HoursSettings({ days, setDays }: { days: Record<string, { enabled: boolean; open: string; close: string }>; setDays: React.Dispatch<React.SetStateAction<Record<string, { enabled: boolean; open: string; close: string }>>> }) {
  return <div className="space-y-5"><Card title="Horário de funcionamento" description="Defina quando o restaurante aceita pedidos."><div className="space-y-2">{Object.entries(days).map(([day, value]) => <div key={day} className="grid grid-cols-[110px_1fr_110px_110px] items-center gap-3 rounded-lg border border-border p-3"><div className="flex items-center gap-2"><Switch checked={value.enabled} onCheckedChange={(enabled) => setDays((prev) => ({ ...prev, [day]: { ...prev[day], enabled } }))} /><span className="text-sm font-medium">{day}</span></div><span className={cn("text-xs", value.enabled ? "text-green-600" : "text-muted-foreground")}>{value.enabled ? "Aberto" : "Fechado"}</span><Input type="time" value={value.open} disabled={!value.enabled} onChange={(e) => setDays((prev) => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))} /><Input type="time" value={value.close} disabled={!value.enabled} onChange={(e) => setDays((prev) => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))} /></div>)}</div></Card><Card title="Intervalo de almoço" description="Opcionalmente, pause os pedidos durante um intervalo."><ToggleRow title="Ativar intervalo" description="Os clientes não poderão fazer pedidos nesse período." /><div className="mt-4 grid max-w-sm grid-cols-2 gap-3"><Input type="time" defaultValue="14:00" /><Input type="time" defaultValue="16:00" /></div></Card></div>;
}

function AutomationSettings({ automations, setAutomations }: { automations: { id: string; title: string; description: string; enabled: boolean; text: string }[]; setAutomations: React.Dispatch<React.SetStateAction<{ id: string; title: string; description: string; enabled: boolean; text: string }[]>> }) {
  return <div className="space-y-5"><Card title="Respostas automáticas" description="Personalize as mensagens que serão enviadas sem intervenção manual."><div className="space-y-3">{automations.map((item) => <div key={item.id} className="rounded-lg border border-border p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-medium text-foreground">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></div><Switch checked={item.enabled} onCheckedChange={(enabled) => setAutomations((prev) => prev.map((current) => current.id === item.id ? { ...current, enabled } : current))} /></div><Textarea value={item.text} onChange={(e) => setAutomations((prev) => prev.map((current) => current.id === item.id ? { ...current, text: e.target.value } : current))} className="mt-3 min-h-20 text-sm" /></div>)}</div></Card><Card title="Regras de resposta" description="Defina como o assistente deve agir nas conversas."><ToggleRow title="Sugerir itens do cardápio" description="Recomenda opções quando o cliente pedir sugestões." defaultChecked /><ToggleRow title="Enviar resumo antes de confirmar" description="Mostra itens, quantidades e total para o cliente." defaultChecked /></Card></div>;
}

function IntegrationSettings({ integrations, setIntegrations }: { integrations: { id: string; name: string; detail: string; connected: boolean }[]; setIntegrations: React.Dispatch<React.SetStateAction<{ id: string; name: string; detail: string; connected: boolean }[]>> }) {
  return <div className="space-y-5"><Card title="Canais conectados" description="Conecte serviços externos para centralizar seus pedidos."><div className="space-y-3">{integrations.map((integration) => <div key={integration.id} className="flex items-center justify-between rounded-lg border border-border p-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Webhook className="h-4 w-4" /></div><div><p className="font-medium">{integration.name}</p><p className="text-xs text-muted-foreground">{integration.detail}</p></div></div><Button variant={integration.connected ? "outline" : "default"} size="sm" onClick={() => setIntegrations((prev) => prev.map((current) => current.id === integration.id ? { ...current, connected: !current.connected } : current))}>{integration.connected ? "Desconectar" : "Conectar"}</Button></div>)}</div><Button variant="outline" className="mt-4 gap-2"><Plus className="h-4 w-4" />Adicionar integração</Button></Card><Card title="API e webhooks" description="Use essas configurações para conectar seu sistema a outras APIs."><div className="space-y-4"><div className="space-y-2"><Label>URL do webhook de pedidos</Label><Input placeholder="https://seu-sistema.com/webhooks/pedidos" /></div><div className="space-y-2"><Label>Chave de API</Label><Input type="password" placeholder="••••••••••••••••" /></div><div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><Bot className="h-4 w-4 shrink-0 text-primary" />As credenciais são usadas apenas para comunicação segura entre os serviços.</div></div></Card></div>;
}

function ToggleRow({ title, description, defaultChecked = false }: { title: string; description: string; defaultChecked?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-foreground">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><Switch defaultChecked={defaultChecked} /></div>;
}

void Bell;
void Trash2;
void ToggleRow;
void Card;
void RestaurantSettings;
void HoursSettings;
void AutomationSettings;
void IntegrationSettings;
void Label;
void Input;
void Textarea;
void Button;
void Switch;
void cn;
void useState;
void Save;
void Settings2;
void Clock3;
void MessageSquareText;
void Link2;
void Plus;
void Webhook;
void Bot;
void Check;
export default SettingsPage;
       
