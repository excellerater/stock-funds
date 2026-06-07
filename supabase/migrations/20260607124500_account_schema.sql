create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, fund_id)
);

create table if not exists public.user_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  invested_amount numeric(18, 2) not null default 0
    check (invested_amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, fund_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fund_id text not null,
  transaction_type text not null
    check (transaction_type in ('buy', 'sell', 'dividend', 'fee')),
  trade_date date not null,
  amount numeric(18, 2) not null check (amount >= 0),
  shares numeric(24, 8) check (shares is null or shares >= 0),
  nav numeric(18, 8) check (nav is null or nav >= 0),
  fee numeric(18, 2) not null default 0 check (fee >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_portfolio_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  invested_amount numeric(18, 2) not null default 0,
  estimated_value numeric(18, 2) not null default 0,
  daily_pnl numeric(18, 2) not null default 0,
  cumulative_pnl numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

alter table public.profiles enable row level security;
alter table public.user_favorites enable row level security;
alter table public.user_positions enable row level security;
alter table public.transactions enable row level security;
alter table public.daily_portfolio_snapshots enable row level security;

grant select, insert, update, delete
  on public.profiles, public.user_favorites, public.user_positions, public.transactions
  to authenticated;

grant select
  on public.daily_portfolio_snapshots
  to authenticated;

drop policy if exists "Users manage their profile" on public.profiles;
create policy "Users manage their profile"
  on public.profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their favorites" on public.user_favorites;
create policy "Users manage their favorites"
  on public.user_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their positions" on public.user_positions;
create policy "Users manage their positions"
  on public.user_positions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their transactions" on public.transactions;
create policy "Users manage their transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users read their snapshots" on public.daily_portfolio_snapshots;
create policy "Users read their snapshots"
  on public.daily_portfolio_snapshots for select
  using (auth.uid() = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();
