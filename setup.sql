-- Run this in your Supabase project's SQL Editor (left sidebar → SQL Editor → New query)

create table records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  album text not null,
  artist text not null,
  year text,
  genre text,
  format text,
  condition text,
  price numeric,
  purchase_date date,
  notes text,
  cover_url text,
  label text,
  catalog_number text,
  country text,
  release_type text,
  tracklist text,
  is_face boolean not null default false,
  added_at bigint,
  created_at timestamptz default now()
);

-- Row Level Security: this is what actually keeps one user's
-- collection private from another. Without these policies, anyone
-- with your anon key could read or write any row.
alter table records enable row level security;

create policy "Users can view their own records"
  on records for select
  using (auth.uid() = user_id);

create policy "Users can insert their own records"
  on records for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own records"
  on records for update
  using (auth.uid() = user_id);

create policy "Users can delete their own records"
  on records for delete
  using (auth.uid() = user_id);
