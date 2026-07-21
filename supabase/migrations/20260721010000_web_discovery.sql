-- Compliant open-web discovery provenance. Raw page bodies are intentionally never persisted.
alter table public.events
  add column if not exists source_domain text,
  add column if not exists discovery_query text,
  add column if not exists extraction_method text check (extraction_method in ('structured', 'llm', 'api', 'rss', 'demo')),
  add column if not exists extraction_confidence numeric check (extraction_confidence between 0 and 1),
  add column if not exists evidence_snippets text[] not null default '{}',
  add column if not exists robots_decision text check (robots_decision in ('allowed', 'disallowed', 'unavailable')),
  add column if not exists registration_url text,
  add column if not exists timezone text;

alter table public.events drop constraint if exists events_source_type_check;
alter table public.events add constraint events_source_type_check check (source_type in ('api', 'rss', 'curated-crawler', 'web-discovery'));
create index if not exists events_source_domain_idx on public.events (source_domain);

create table public.web_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.pipeline_status not null default 'running',
  configured_region text,
  query_count integer not null default 0,
  candidate_count integer not null default 0,
  fetched_count integer not null default 0,
  structured_extraction_count integer not null default 0,
  llm_extraction_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.discovery_queries (
  id uuid primary key default gen_random_uuid(),
  web_discovery_run_id uuid not null references public.web_discovery_runs(id) on delete cascade,
  query text not null,
  query_origin text not null check (query_origin in ('deterministic', 'llm-refined')),
  position integer not null,
  created_at timestamptz not null default now()
);

create table public.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  web_discovery_run_id uuid not null references public.web_discovery_runs(id) on delete cascade,
  discovery_query text not null,
  original_url text not null,
  normalized_url text,
  canonical_url text,
  source_domain text,
  title text,
  published_at timestamptz,
  decision text not null check (decision in ('selected', 'skipped', 'robots-disallowed', 'fetched', 'rejected', 'error')),
  reason text,
  created_at timestamptz not null default now()
);

create table public.crawl_attempts (
  id uuid primary key default gen_random_uuid(),
  discovery_candidate_id uuid not null references public.discovery_candidates(id) on delete cascade,
  robots_decision text not null check (robots_decision in ('allowed', 'disallowed', 'unavailable')),
  fetch_status integer,
  outcome text not null check (outcome in ('fetched', 'skipped', 'failed')),
  error_detail text,
  created_at timestamptz not null default now()
);

create table public.source_domain_metadata (
  id uuid primary key default gen_random_uuid(),
  source_domain text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  robots_last_decision text check (robots_last_decision in ('allowed', 'disallowed', 'unavailable')),
  notes text
);

alter table public.web_discovery_runs enable row level security;
alter table public.discovery_queries enable row level security;
alter table public.discovery_candidates enable row level security;
alter table public.crawl_attempts enable row level security;
alter table public.source_domain_metadata enable row level security;

create policy "users read their web discovery runs" on public.web_discovery_runs for select to authenticated using (user_id = auth.uid());
create policy "users read their discovery queries" on public.discovery_queries for select to authenticated using (exists (select 1 from public.web_discovery_runs r where r.id = web_discovery_run_id and r.user_id = auth.uid()));
create policy "users read their discovery candidates" on public.discovery_candidates for select to authenticated using (exists (select 1 from public.web_discovery_runs r where r.id = web_discovery_run_id and r.user_id = auth.uid()));
create policy "users read their crawl attempts" on public.crawl_attempts for select to authenticated using (exists (select 1 from public.discovery_candidates c join public.web_discovery_runs r on r.id = c.web_discovery_run_id where c.id = discovery_candidate_id and r.user_id = auth.uid()));
create policy "authenticated users read public source metadata" on public.source_domain_metadata for select to authenticated using (true);
