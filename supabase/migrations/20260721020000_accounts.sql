-- Account lifecycle and profile persistence additions.
-- Auth owns the login email; digest_email is an optional delivery preference.
alter table public.profiles
  add column if not exists digest_email text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists last_active_at timestamptz;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_profile_updated_at();

-- Keep the auth-triggered profile record aligned with the profile API even
-- when a user signs in before completing onboarding.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username, digest_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create index if not exists profiles_onboarding_completed_idx on public.profiles (onboarding_completed) where onboarding_completed = true;
create index if not exists profiles_digest_frequency_idx on public.profiles (digest_frequency);
