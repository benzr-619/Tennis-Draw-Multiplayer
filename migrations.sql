-- Slam Bracket Multiplayer — Supabase Migrations
-- Run these in order in the Supabase SQL editor.
-- Supabase Auth handles the core users table (auth.users).
-- These tables extend it.

-- ─────────────────────────────────────────
-- 1. PROFILES
-- Extends auth.users with display name and role.
-- ─────────────────────────────────────────

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  display_name     text not null,
  is_commissioner  boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up.
-- display_name is set by the app during signup via upsert.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

create policy "Users can read all profiles"
  on public.profiles for select
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);


-- ─────────────────────────────────────────
-- 2. DRAWS
-- One row per slam + draw_type + year.
-- Shared across all users.
-- ─────────────────────────────────────────

create table public.draws (
  id                      uuid primary key default gen_random_uuid(),
  slam                    text not null check (slam in ('AO','RG','WIM','USO')),
  draw_type               text not null check (draw_type in ('MS','WS')),
  year                    text not null,
  created_by              uuid references public.profiles(id),
  original_picks_locked   boolean not null default false,
  created_at              timestamptz not null default now(),
  unique (slam, draw_type, year)
);

-- RLS
alter table public.draws enable row level security;

create policy "All authenticated users can read draws"
  on public.draws for select
  using (auth.role() = 'authenticated');

create policy "Commissioner can insert draws"
  on public.draws for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );

create policy "Commissioner can update draws"
  on public.draws for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );


-- ─────────────────────────────────────────
-- 3. MATCHES
-- 127 rows per draw (rounds 0–6).
-- Shared structure — winner/score set by commissioner.
-- ─────────────────────────────────────────

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  draw_id       uuid not null references public.draws(id) on delete cascade,
  round_index   int not null check (round_index between 0 and 6),
  match_index   int not null,
  p1_name       text not null default '',
  p1_seed       text not null default '',
  p2_name       text not null default '',
  p2_seed       text not null default '',
  winner        text,          -- confirmed winner name; null until commissioner sets it
  score         text,          -- freeform match score text
  created_at    timestamptz not null default now(),
  unique (draw_id, round_index, match_index)
);

-- RLS
alter table public.matches enable row level security;

create policy "All authenticated users can read matches"
  on public.matches for select
  using (auth.role() = 'authenticated');

create policy "Commissioner can insert matches"
  on public.matches for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );

create policy "Commissioner can update matches"
  on public.matches for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );

create policy "Commissioner can delete matches"
  on public.matches for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );


-- ─────────────────────────────────────────
-- 4. PICKS
-- One row per user × match.
-- Upserted on every pick change.
-- ─────────────────────────────────────────

create table public.picks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  draw_id             uuid not null references public.draws(id) on delete cascade,
  match_id            uuid not null references public.matches(id) on delete cascade,
  pick                text,             -- current active pick (player name)
  original_pick       text,             -- snapshotted at lock; never mutated after lock except withdrawal
  result              text check (result in ('correct','wrong')),
  high_confidence     boolean not null default false,
  edited_after_lock   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, match_id)
);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger picks_updated_at
  before update on public.picks
  for each row execute procedure public.handle_updated_at();

-- RLS
alter table public.picks enable row level security;

create policy "Users can read all picks"
  on public.picks for select
  using (auth.role() = 'authenticated');

create policy "Users can insert their own picks"
  on public.picks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own picks"
  on public.picks for update
  using (auth.uid() = user_id);

-- Commissioner can update picks (for result/original_pick snapshotting at lock)
create policy "Commissioner can update any picks"
  on public.picks for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );


-- ─────────────────────────────────────────
-- 5. LOCK SCHEDULES
-- Commissioner-defined lock windows.
-- Each row locks a range of matches in a round.
-- ─────────────────────────────────────────

create table public.lock_schedules (
  id                  uuid primary key default gen_random_uuid(),
  draw_id             uuid not null references public.draws(id) on delete cascade,
  round_index         int not null check (round_index between 0 and 6),
  match_index_start   int,              -- null = whole round
  match_index_end     int,              -- null = whole round
  lock_type           text not null check (lock_type in ('original_picks','backup_picks')),
  label               text,             -- optional human-readable label e.g. "Day 3 upper"
  scheduled_at        timestamptz,      -- when commissioner intends to trigger
  locked_at           timestamptz,      -- set when actually triggered; null = not yet locked
  created_at          timestamptz not null default now()
);

-- RLS
alter table public.lock_schedules enable row level security;

create policy "All authenticated users can read lock schedules"
  on public.lock_schedules for select
  using (auth.role() = 'authenticated');

create policy "Commissioner can manage lock schedules"
  on public.lock_schedules for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_commissioner = true)
  );


-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

create index on public.matches (draw_id);
create index on public.picks (draw_id);
create index on public.picks (user_id);
create index on public.picks (match_id);
create index on public.lock_schedules (draw_id);
