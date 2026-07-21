# MEET

> Opportunity shouldn’t be a rumor you have to be lucky enough to overhear.

MEET is a transparent opportunity-intelligence product for events, hackathons, workshops, and meetups. It discovers opportunities, removes duplicates, ranks them for a specific person, and shows exactly why every decision was made.

## What is built

- A polished responsive Next.js product: landing page, three-step profile onboarding, ranked dashboard, filters, event detail, score breakdown, network, settings, About page, and a live Trust Ledger.
- Resume and LinkedIn-export ingestion. Text, CSV, JSON, and text-based PDF uploads are parsed once into editable skills, interests, stage, and goals.
- Four parallel ingestion strategies: Eventbrite, an RSS/ICS-style event feed, up to three permission-safe curated HTML seed pages, and compliant Exa-backed open-web discovery.
- Every web-discovered event retains its discovery query, original public source URL/domain, extraction method, confidence, and short page evidence. The event detail view exposes this provenance.
- Deterministic deduplication, ranking math, filters, score explanations, feedback actions, and portfolio insights.
- Groq-powered profile extraction, permitted-page event extraction, and semantic relevance only.
- Supabase Auth magic links, a complete Postgres schema, network and attendance tables, and Row Level Security policies.
- Resend digest endpoint, with a “send test digest” control.
- A clearly labeled sample mode, so the product is immediately explorable before any external keys are connected. It never presents samples as live source data.

## AI is deliberately narrow

MEET uses Groq’s `llama-3.1-8b-instant`, the current lowest-cost production text model on Groq, for the language jobs that genuinely need it:

| Job | Method | Why |
| --- | --- | --- |
| Resume / LinkedIn profile extraction | Groq | Inputs are unstructured text. |
| Permitted HTML event extraction | Groq | Event listings vary dramatically by page. |
| Open-web query diversification | Optional Groq | Improves the bounded deterministic query set; never required. |
| Relevance score | Groq | Semantic fit needs a judgment against the person’s goals. |
| Duplicate matching | Deterministic code | Token overlap + same date; transparent and instant. |
| Distance / format / timing / final score | Deterministic code | Plain mathematics and user-controlled weights. |
| “Why not?” explanation | Deterministic code | A template based on the actual lowest score, never invented. |
| Feedback reweighting | Deterministic code | Based on explicit saved, dismissed, and going actions. |

MEET uses Groq privately for semantic matching when it is configured, but the interface keeps the result simple: it shows the event distance and a short plain-language explanation based on the member’s stated goals, interests, schedule, and format preferences.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000). The sample experience runs without any environment variables.

After adding keys to `.env.local`, restart the dev server so Next.js reloads them, then select **Refresh MEET** in the top-right of the app. A live refresh uses only the source keys you configured; if no live source returns events, the app deliberately falls back to its labeled sample feed.

For a production build:

```bash
npm run typecheck
npm test
npm run build
```

## Connect the real services

### 1. Supabase

1. Create a Supabase project.
2. Link this repository with the Supabase CLI and run the migration:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. In Supabase Auth, enable email magic links and add your local and Vercel URLs as redirect URLs.
4. Copy the project URL, publishable key, and service-role key into `.env.local`.

The migrations at [`supabase/migrations`](./supabase/migrations) create profiles, events, scores, refresh runs, pipeline logs, dedup decisions, preferences, connections, attendance, missed opportunities, and web-discovery provenance tables. RLS keeps a user’s discovery runs private; raw fetched page text is never persisted.

### 2. Groq

Set `GROQ_API_KEY`. The default `GROQ_MODEL=llama-3.1-8b-instant` is intentional and can be left unchanged. Set a spend limit in Groq before a public deployment.

### 3. Opportunity sources

Set whichever sources are available to you:

- `EVENTBRITE_PRIVATE_TOKEN` and optionally `EVENTBRITE_LOCATION`
- `MEET_RSS_FEED_URL` for a verified community calendar feed
- `CRAWL_SEED_URLS` as a comma-separated list of no more than three explicitly permission-safe public event pages
- `EXA_API_KEY` plus `WEB_DISCOVERY_ENABLED=true` to enable open-web candidate discovery

Sources run in parallel. The ledger reports each source’s outcome, normalized count, web queries, skipped candidates, robots decisions, structured/LLM extraction, dedup decision, and score completion.

### 4. Compliant web discovery

Web discovery is a fourth source strategy; it does not replace Eventbrite, RSS, or curated crawls.

1. MEET builds no more than six deterministic location/profile/date-aware queries, and may ask Groq to diversify them when `WEB_DISCOVERY_REFINE_QUERIES=true`.
2. Exa returns at most 30 **candidate pages**. Search results are never treated as events.
3. MEET normalizes URLs; removes tracking IDs and duplicates; blocks login-dependent social sites, checkout, private-profile, generic-search, and unsupported-document URLs; then enforces a 15-page total and two-pages-per-domain budget by default.
4. Before every fetch it checks `robots.txt`. A denied or unavailable robots rule is a skip, never a bypass. Fetches are server-side, rate-limited per domain, time-bounded, and retried with small backoff.
5. MEET prefers JSON-LD Event, RSS/Atom, ICS, and Open Graph-style public metadata. Only when structured Event data is absent does it pass cleaned public page text to Groq.
6. An extraction is rejected unless it has a title, a valid future date, a valid original source URL, and page evidence. It is also pre-filtered for format preference, known distance/radius, clear irrelevance, and deduplication before batched semantic relevance scoring.

The event detail provenance panel distinguishes **Web-discovered**, **Structured source**, **LLM-reasoned**, and **Computed**. The Trust Ledger lists query generation, candidate screening, robots skips, fetch failures, extraction method, rejected extraction reason, and merges.

#### Crawling boundaries

- MEET never bypasses paywalls, CAPTCHAs, authentication, `robots.txt`, site restrictions, or rate limits.
- It never fetches login-required social media, ticket checkout, personal-profile, or private-data pages.
- It stores public event metadata and provenance only—never entire fetched pages indefinitely.
- Add a comma-separated domain to `WEB_DISCOVERY_BLOCKED_DOMAINS` to block it immediately. Tune `WEB_DISCOVERY_MAX_*` values to reduce cost and crawl footprint further.

### 5. Resend

Set `RESEND_API_KEY` and `DIGEST_FROM_EMAIL` after verifying a sending domain in Resend. The API route composes and sends a real ranked digest.

## Environment variables

All expected values are listed in [`.env.example`](./.env.example).

| Variable | Required for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser auth and database client |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser auth and database client |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server-side persistence jobs |
| `GROQ_API_KEY` | Profile parsing, page extraction, relevance reasoning |
| `EVENTBRITE_API_KEY` | Eventbrite authenticated API access (legacy token also supported) |
| `MEET_RSS_FEED_URL` | Community feed ingestion |
| `CRAWL_SEED_URLS` | Permission-safe HTML extraction |
| `EXA_API_KEY` | Server-side Exa candidate search |
| `WEB_DISCOVERY_ENABLED` | Explicit opt-in for open-web discovery |
| `WEB_DISCOVERY_MAX_QUERIES`, `WEB_DISCOVERY_MAX_RESULTS` | Bounded query and result counts (max 6 / 30) |
| `WEB_DISCOVERY_MAX_FETCHES`, `WEB_DISCOVERY_MAX_PAGES_PER_DOMAIN` | Fetch budget (max 15 / 2 per domain) |
| `WEB_DISCOVERY_ALLOWED_REGIONS`, `WEB_DISCOVERY_BLOCKED_DOMAINS` | Regional scope and deterministic domain exclusions |
| `WEB_DISCOVERY_USER_AGENT` | Identifies MEET during compliant source fetches |
| `MEET_LOCATION_COUNTRY_CODE` | Optional ISO 3166-1 alpha-2 scope for address/ZIP lookup, e.g. `us` |
| `RESEND_API_KEY` + `DIGEST_FROM_EMAIL` | Scheduled/test email digest |
| `CRON_SECRET` | Authorizes Vercel Cron-compatible `/api/cron/refresh` |

## Deployment

Deploy the repository to Vercel and set the same environment variables in the Vercel project. Add the Vercel URL to Supabase Auth redirect URLs. [`vercel.json`](./vercel.json) schedules `GET /api/cron/refresh` daily at 13:00 UTC; Vercel supplies `Authorization: Bearer $CRON_SECRET` when the secret is configured. The route is server-only, processes up to ten daily/weekly profiles per invocation, and isolates a failed profile so it does not stop the batch.

## Tests

`npm test` covers query construction, URL normalization, candidate filtering and per-domain budgets, robots decisions, deterministic relevance fallback, extraction validation, provenance projection, and web-discovered-event deduplication.

## Deliberate scope notes

- MEET has no ticket purchasing or payment handling; every event links directly to its original source.
- The crawler accepts only the named, permission-safe seed pages you configure.
- Web discovery is intentionally bounded. It cannot discover pages Exa does not return, pages denied by robots rules, or events with insufficient public evidence; this is a safety constraint, not a hidden retry path.
- The UI works in transparent sample mode until real source credentials are supplied. This is a product demo fallback, not hidden mock data.
