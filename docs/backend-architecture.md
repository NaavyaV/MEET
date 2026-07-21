# MEET backend architecture

MEET is a Next.js application with server-side ingestion routes and Supabase as its system of record. A browser never receives the Supabase service-role key, Groq key, Exa key, or mail key.

## Request flow

1. A member signs up or signs in with Supabase Auth. The `on_auth_user_created` database trigger creates a matching `profiles` row.
2. Onboarding saves normalized profile fields—name, goals, skills, interests, location coordinates, travel preference, format, and availability—to `profiles`. The uploaded resume itself is never stored.
3. **Refresh MEET** posts the current profile to `/api/pipeline/refresh`. The server verifies the bearer token, then runs the source pipeline.
4. RSS/ICS feeds, explicitly permitted seed pages, and Exa-backed web discovery run as independent sources. They produce a common `Opportunity` shape.
5. The server de-duplicates the events, asks Groq only for bounded semantic relevance/extraction work, calculates the final score in deterministic code, persists the result, and sends the ranked cards back to the browser.

## Discovery and quality controls

- RSS/ICS: up to six configured public feeds. Only explicit future event dates inside the next 62 days become cards. Physical cards also need coordinates that place them inside the member's travel area.
- Curated seeds: up to three URLs supplied by the operator. MEET checks `robots.txt`, uses a named user agent, observes a timeout, and extracts only evidence-backed events.
- Open web: Exa produces candidate pages, not events. MEET normalizes URLs, blocks login/private/checkout sources and configured domains, checks `robots.txt`, applies per-domain and total-page budgets, then prefers JSON-LD, ICS, RSS/Atom, and Open Graph event data. For open-web discovery, Groq is the fallback for a maximum of two compact unstructured pages per refresh.
- Evidence gate: a card needs a title, valid future date, source URL, and short source evidence. The raw page body is never persisted.

The Groq extractor receives no more than 9,000 cleaned characters and has a 550-token response cap. This keeps individual extraction requests safely inside the low-cost `llama-3.1-8b-instant` rate limits while preserving room for the relevance pass.

## Ranking

MEET uses the travel area as a hard boundary. An in-person or hybrid card must have verified coordinates inside the member's selected radius; unknown-distance and out-of-area physical events are rejected before ranking. Online cards remain available only when the member allows online events.

The card rating is a 0–10 blend of:

- semantic relevance to goals, skills, and interests (70%); and
- verified proximity within the travel area (30%; online events receive full proximity credit).

Groq supplies semantic relevance when configured. Everything else—the geographic gate, math, ordering, deduplication, and the explanation of a lower score—is deterministic code. Strong matches appear first; lower-relevance nearby choices remain in **More to explore** with their actual rating and an explanation.

## Persistence and privacy

`events` stores normalized event metadata and provenance. `event_scores` stores each member's personalized score. `event_preferences` stores saved/dismissed/interested/going decisions, and `event_attendance` stores interest/going attendance. Unsaving deletes the member's preference and attendance rows; it never deletes the event from the feed.

The Network screen uses `connections` for pending and accepted requests. A signed-in member can request a connection by email or username, accept incoming requests, cancel sent requests, or remove an accepted connection. The server verifies the calling user on each mutation and only returns the other connection party's narrow public profile fields.

Row Level Security is enabled on every public table. Normal browser access is limited to the member's rows. Server routes use the service-role client only after validating the member's bearer token, so it can perform narrowly scoped persistence work without exposing a privileged key to the browser.

## Trust ledger

The ledger is a member-facing receipt, not an operations console. It lists the completed source checks, query generation, structured/LLM extraction, deduplication, and ranking pass. Failed requests, robot denials, and rejected candidates remain in server-side diagnostics/provenance rather than cluttering the product UI.

## Operations

- **Supabase** provides Auth and Postgres. Its migrations are in `supabase/migrations`.
- **Exa** discovers public candidate URLs. Its API key stays server-only.
- **Groq** handles small unstructured language tasks using `llama-3.1-8b-instant`.
- **Resend** sends test and scheduled digests when configured.
- **Vercel Cron** can call the protected daily refresh route to refresh digest-eligible profiles.

For a deployment, configure all service keys in the hosting provider's environment settings, set the Supabase Auth redirect URLs, use a real `WEB_DISCOVERY_USER_AGENT` containing the deployed contact URL, and set a Groq spend/rate limit appropriate for the expected refresh volume.
