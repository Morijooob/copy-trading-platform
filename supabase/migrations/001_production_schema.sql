create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  password_hash text,
  email_verified_at timestamptz,
  two_factor_enabled boolean not null default false,
  real_trading_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  exchange text not null,
  api_key_ciphertext text not null,
  api_secret_ciphertext text not null,
  withdrawal_disabled boolean not null default true,
  connection_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, exchange)
);

create table if not exists masters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists master_followers (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references masters(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('ACTIVE','QUEUED','DISABLED')),
  created_at timestamptz not null default now(),
  unique(master_id, user_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  master_id uuid references masters(id),
  follower_id uuid references master_followers(id),
  exchange_order_id text,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  order_type text not null,
  requested_size numeric not null,
  filled_size numeric not null default 0,
  status text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  asset text not null,
  entry_type text not null,
  gross_profit numeric not null default 0,
  commission numeric not null default 0,
  net_amount numeric not null default 0,
  reference_id text,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  event_type text not null,
  request_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_followers_master_status on master_followers(master_id, status, created_at);
create index if not exists idx_orders_follower on orders(follower_id, created_at);
create index if not exists idx_ledger_user on ledger_entries(user_id, created_at);
create index if not exists idx_audit_user on audit_events(user_id, created_at);
