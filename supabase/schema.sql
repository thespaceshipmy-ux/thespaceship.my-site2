-- The Spaceship — Member Portal database schema
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).

-- ---------------------------------------------------------------------------
-- 1. Admins allowlist
-- ---------------------------------------------------------------------------
create table if not exists admins (
  email text primary key
);

-- Add yourself as admin. Add more rows later for any other staff who should
-- see the admin page.
insert into admins (email) values ('aimanmohdmisri@gmail.com')
on conflict (email) do nothing;

-- Helper used by RLS policies below: true if the currently logged-in user's
-- email is in the admins table.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from admins where email = (auth.jwt() ->> 'email')
  );
$$ language sql stable security definer;

-- ---------------------------------------------------------------------------
-- 2. Members
-- ---------------------------------------------------------------------------
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  full_name text not null,
  email text not null,
  phone text,
  membership_type text not null check (membership_type in ('Jamming', 'Recording', 'Producer/Engineer')),
  renewal_date date,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table members enable row level security;

-- A member can see their own row.
create policy "members select own" on members
  for select using (auth.uid() = user_id);

-- Admins can see / edit / add every row.
create policy "admins select all members" on members
  for select using (is_admin());
create policy "admins update all members" on members
  for update using (is_admin());
create policy "admins insert members" on members
  for insert with check (is_admin());

-- ---------------------------------------------------------------------------
-- 3. Bookings
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade not null,
  requested_date date not null,
  requested_start_time time not null,
  duration_hours numeric not null default 1,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table bookings enable row level security;

-- A member can see and create bookings tied to their own member row.
create policy "members select own bookings" on bookings
  for select using (member_id in (select id from members where user_id = auth.uid()));
create policy "members insert own bookings" on bookings
  for insert with check (member_id in (select id from members where user_id = auth.uid()));

-- Admins can see / update every booking (to confirm or decline requests).
create policy "admins select all bookings" on bookings
  for select using (is_admin());
create policy "admins update all bookings" on bookings
  for update using (is_admin());

-- Keep updated_at current on every change.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bookings_set_updated_at on bookings;
create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function set_updated_at();
