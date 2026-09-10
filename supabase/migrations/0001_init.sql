-- PDF Quotes for Chatbots — initial schema
create extension if not exists pgcrypto;

create table public.installs (
  id uuid primary key default gen_random_uuid(),
  sp_client_id text,
  sp_client_secret text,
  sp_user_id text,
  api_key text not null unique,
  settings_token text not null unique,
  status text not null default 'active' check (status in ('active', 'uninstalled')),
  created_at timestamptz not null default now(),
  uninstalled_at timestamptz
);

create table public.settings (
  install_id uuid primary key references public.installs(id) on delete cascade,
  company_name text not null default 'Your Company',
  email text,
  phone text,
  website text,
  address text,
  logo_path text,
  brand_color text not null default '#2563eb',
  currency text not null default 'USD',
  footer_note text not null default 'This quote is valid for 14 days.',
  services jsonb not null default '[{"name": "Standard service", "base_price": 100}]',
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references public.installs(id) on delete cascade,
  customer_name text not null,
  service_name text not null,
  quantity numeric,
  total numeric not null,
  currency text not null,
  pdf_path text not null,
  created_at timestamptz not null default now()
);

create index quotes_install_idx on public.quotes (install_id, created_at desc);

-- Service-role only: enable RLS with no policies so anon/authenticated get nothing.
alter table public.installs enable row level security;
alter table public.settings enable row level security;
alter table public.quotes enable row level security;

-- Private storage buckets
insert into storage.buckets (id, name, public)
values ('logos', 'logos', false), ('quotes', 'quotes', false)
on conflict (id) do nothing;
