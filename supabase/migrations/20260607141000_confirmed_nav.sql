alter table public.user_positions
  add column if not exists confirmed_nav numeric(18, 8)
    check (confirmed_nav is null or confirmed_nav >= 0),
  add column if not exists confirmed_nav_date date;
