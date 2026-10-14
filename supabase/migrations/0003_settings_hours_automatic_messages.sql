-- 0003_settings_hours_automatic_messages.sql
--
-- restaurant_settings, business_hours, automatic_messages (05.data-model.md).
-- FR-080–089, FR-083, FR-100–119.

create table if not exists public.restaurant_settings (
  restaurant_id             uuid primary key references public.restaurants(id) on delete cascade,
  auto_accept               boolean not null default false,
  allow_pickup              boolean not null default true,
  show_delivery_estimate    boolean not null default true,
  delivery_estimate_minutes integer not null default 45 check (delivery_estimate_minutes between 5 and 240),
  delivery_fee_cents        bigint not null default 0 check (delivery_fee_cents >= 0),
  timezone                  text not null default 'America/Sao_Paulo',
  updated_at                timestamptz not null default now()
);

create trigger restaurant_settings_set_updated_at
  before update on public.restaurant_settings
  for each row execute function mt.set_updated_at();

select mt.apply_tenant_policies('restaurant_settings', 'member', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------

create table if not exists public.business_hours (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  enabled       boolean not null default true,
  opens_at      time not null,
  closes_at     time not null,
  constraint business_hours_nonempty check (closes_at <> opens_at),
  unique (restaurant_id, weekday)
);

comment on column public.business_hours.weekday is '0 = Sunday, as extract(dow from ...).';
comment on column public.business_hours.closes_at is 'When closes_at < opens_at the interval ends on the next day.';

select mt.apply_tenant_policies('business_hours', 'member', 'admin', 'admin', 'admin');

-- ---------------------------------------------------------------------------

create table if not exists public.automatic_messages (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  kind              text not null check (kind in ('welcome', 'closed', 'order_received')),
  enabled           boolean not null default true,
  body              text not null check (char_length(body) between 1 and 1000),
  template_name     text,
  template_language text,
  updated_at        timestamptz not null default now(),
  constraint automatic_messages_template_pair check ((template_name is null) = (template_language is null)),
  unique (restaurant_id, kind)
);

create trigger automatic_messages_set_updated_at
  before update on public.automatic_messages
  for each row execute function mt.set_updated_at();

select mt.apply_tenant_policies('automatic_messages', 'member', 'admin', 'admin', 'admin');
