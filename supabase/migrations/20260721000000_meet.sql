-- MEET's system of record. Run with `supabase db push` after linking a project.
create extension if not exists "pgcrypto";

create type public.event_format as enum ('in-person', 'online', 'hybrid');
create type public.connection_status as enum ('pending', 'accepted');
create type public.attendance_status as enum ('interested', 'going');
create type public.preference_action as enum ('saved', 'dismissed', 'interested', 'going');
create type public.pipeline_status as enum ('running', 'complete', 'skipped', 'attention');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  avatar_url text,
  skills text[] not null default '{}',
  interests text[] not null default '{}',
  career_stage text,
  goals text,
  location_label text,
  latitude numeric,
  longitude numeric,
  travel_radius_miles integer not null default 15 check (travel_radius_miles between 0 and 500),
  format_preference text not null default 'both' check (format_preference in ('in-person', 'online', 'both')),
  availability text not null default 'flexible' check (availability in ('weekdays', 'evenings', 'weekends', 'flexible')),
  weights jsonb not null default '{"relevance":38,"distance":20,"format":14,"timing":13,"caliber":15}'::jsonb,
  digest_frequency text not null default 'weekly' check (digest_frequency in ('daily', 'weekly', 'on-demand')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  canonical_url text not null,
  source text not null,
  source_type text not null check (source_type in ('api', 'rss', 'crawler')),
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  event_format public.event_format not null,
  venue text,
  address text,
  latitude numeric,
  longitude numeric,
  category text,
  tags text[] not null default '{}',
  image_url text,
  scale_score numeric check (scale_score between 0 and 10),
  scale_reasoning text,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source, external_id),
  unique (canonical_url)
);
create index events_starts_at_idx on public.events (starts_at);
create index events_tags_idx on public.events using gin (tags);

create table public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.pipeline_status not null default 'running',
  source_summary jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.pipeline_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.refresh_runs(id) on delete cascade,
  kind text not null check (kind in ('source', 'dedup', 'score', 'system')),
  status public.pipeline_status not null,
  title text not null,
  detail text not null,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create table public.dedup_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.refresh_runs(id) on delete cascade,
  kept_event_id uuid references public.events(id) on delete set null,
  candidate_event_id uuid references public.events(id) on delete set null,
  title_similarity numeric,
  date_match boolean,
  distance_miles numeric,
  resolution text not null check (resolution in ('merged', 'kept-separate', 'llm-fallback')),
  reasoning text not null,
  created_at timestamptz not null default now()
);

create table public.event_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  relevance_score numeric not null check (relevance_score between 0 and 10),
  distance_score numeric not null check (distance_score between 0 and 10),
  format_score numeric not null check (format_score between 0 and 10),
  timing_score numeric not null check (timing_score between 0 and 10),
  caliber_score numeric not null check (caliber_score between 0 and 10),
  final_score numeric not null check (final_score between 0 and 10),
  relevance_reasoning text,
  low_score_explanation text not null,
  weights jsonb not null,
  computed_at timestamptz not null default now(),
  unique (user_id, event_id)
);
create index event_scores_user_rank_idx on public.event_scores (user_id, final_score desc);

create table public.event_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  action public.preference_action not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table public.event_attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status public.attendance_status not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create table public.missed_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  occurred_at timestamptz,
  source_hint text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.refresh_runs enable row level security;
alter table public.pipeline_logs enable row level security;
alter table public.dedup_decisions enable row level security;
alter table public.event_scores enable row level security;
alter table public.event_preferences enable row level security;
alter table public.connections enable row level security;
alter table public.event_attendance enable row level security;
alter table public.missed_opportunities enable row level security;

create policy "users read their own complete profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "users update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "users create their own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "authenticated users can read normalized events" on public.events for select to authenticated using (true);
create policy "users can read their refresh runs" on public.refresh_runs for select to authenticated using (user_id = auth.uid());
create policy "users can create their refresh runs" on public.refresh_runs for insert to authenticated with check (user_id = auth.uid());
create policy "users can update their refresh runs" on public.refresh_runs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users can read logs from their runs" on public.pipeline_logs for select to authenticated using (exists (select 1 from public.refresh_runs r where r.id = run_id and r.user_id = auth.uid()));
create policy "users read their own scores" on public.event_scores for select to authenticated using (user_id = auth.uid());
create policy "users manage their own preferences" on public.event_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "participants can read their connection requests" on public.connections for select to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "users send connection requests" on public.connections for insert to authenticated with check (requester_id = auth.uid());
create policy "addressees accept their connection requests" on public.connections for update to authenticated using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
create policy "users remove their own connection requests" on public.connections for delete to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "users manage their attendance" on public.event_attendance for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "accepted connections can see attendance" on public.event_attendance for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.connections c where c.status = 'accepted' and ((c.requester_id = auth.uid() and c.addressee_id = event_attendance.user_id) or (c.addressee_id = auth.uid() and c.requester_id = event_attendance.user_id))
  )
);
create policy "users manage their missed opportunities" on public.missed_opportunities for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A deliberately narrow profile surface for accepted-network UI. Full profiles remain private.
create view public.public_profiles as select id, username, full_name, avatar_url from public.profiles;
grant select on public.public_profiles to authenticated;

-- Lets a signed-in user request a connection by email or username without exposing a searchable email directory.
create or replace function public.request_connection_by_identifier(identifier text)
returns public.connections
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_id uuid;
  connection public.connections;
begin
  select p.id into target_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(p.username) = lower(identifier) or lower(u.email) = lower(identifier)
  limit 1;
  if target_id is null then raise exception 'No MEET user found for that email or username'; end if;
  if target_id = auth.uid() then raise exception 'You cannot add yourself'; end if;
  select * into connection from public.connections
  where (requester_id = auth.uid() and addressee_id = target_id) or (requester_id = target_id and addressee_id = auth.uid())
  limit 1;
  if connection.id is not null then return connection; end if;
  insert into public.connections (requester_id, addressee_id) values (auth.uid(), target_id) returning * into connection;
  return connection;
end;
$$;
grant execute on function public.request_connection_by_identifier(text) to authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), nullif(new.raw_user_meta_data ->> 'username', ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
