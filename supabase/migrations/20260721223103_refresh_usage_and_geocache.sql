-- Enforce a modest daily discovery allowance without exposing usage data to
-- browser clients. A new calendar row naturally resets usage at midnight
-- America/Chicago; no destructive daily job is needed.
create table if not exists public.refresh_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  refresh_count integer not null default 0 check (refresh_count >= 0),
  groq_tokens_reserved integer not null default 0 check (groq_tokens_reserved >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.refresh_usage enable row level security;
revoke all on table public.refresh_usage from anon, authenticated;
grant select, insert, update, delete on table public.refresh_usage to service_role;

-- Service-only cache for public venue/address lookups. It avoids repeating
-- geocoding requests and lets locally described event pages pass the same
-- distance check as pages that already supply JSON-LD geo coordinates.
create table if not exists public.event_location_cache (
  location_key text primary key,
  query_text text not null,
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  provider text not null default 'nominatim',
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

alter table public.event_location_cache enable row level security;
revoke all on table public.event_location_cache from anon, authenticated;
grant select, insert, update, delete on table public.event_location_cache to service_role;
create index if not exists event_location_cache_expires_at_idx on public.event_location_cache (expires_at);

create or replace function public.reserve_refresh_quota(
  p_user_id uuid,
  p_email text,
  p_estimated_groq_tokens integer default 7500
)
returns table (
  allowed boolean,
  unlimited boolean,
  refreshes_remaining integer,
  groq_tokens_remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage_date date := (now() at time zone 'America/Chicago')::date;
  v_reset_at timestamptz := (date_trunc('day', now() at time zone 'America/Chicago') + interval '1 day') at time zone 'America/Chicago';
  v_count integer;
  v_tokens integer;
  v_reservation integer := greatest(0, least(coalesce(p_estimated_groq_tokens, 7500), 7500));
  v_refresh_limit constant integer := 3;
  v_token_limit constant integer := 22500;
begin
  -- The project owner remains unrestricted for demos, judging, and support.
  if lower(coalesce(p_email, '')) = 'naavya.vig@gmail.com' then
    return query select true, true, null::integer, null::integer, v_reset_at;
    return;
  end if;

  insert into public.refresh_usage as usage (user_id, usage_date, refresh_count, groq_tokens_reserved)
  values (p_user_id, v_usage_date, 1, v_reservation)
  on conflict (user_id, usage_date) do update
    set refresh_count = usage.refresh_count + 1,
        groq_tokens_reserved = usage.groq_tokens_reserved + v_reservation,
        updated_at = now()
    where usage.refresh_count < v_refresh_limit
      and usage.groq_tokens_reserved + v_reservation <= v_token_limit
  returning refresh_count, groq_tokens_reserved into v_count, v_tokens;

  if found then
    return query select true, false, v_refresh_limit - v_count, v_token_limit - v_tokens, v_reset_at;
    return;
  end if;

  select usage.refresh_count, usage.groq_tokens_reserved
    into v_count, v_tokens
  from public.refresh_usage as usage
  where usage.user_id = p_user_id and usage.usage_date = v_usage_date;

  return query select false, false,
    greatest(0, v_refresh_limit - coalesce(v_count, 0)),
    greatest(0, v_token_limit - coalesce(v_tokens, 0)),
    v_reset_at;
end;
$$;

revoke execute on function public.reserve_refresh_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_refresh_quota(uuid, text, integer) to service_role;
