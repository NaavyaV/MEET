import { extractEventsWithGroq, groqConfigured, refineDiscoveryQueriesWithGroq } from "./groq";
import { DiscoveryCandidate, DiscoveryDiagnostics, EventFormat, EventProvenance, LedgerEntry, Opportunity, UserProfile } from "./types";

const DEFAULT_BLOCKED_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "discord.com",
  "accounts.google.com", "google.com", "bing.com", "yahoo.com",
];
const IRRELEVANT_TERMS = /\b(wedding|nightclub|concert tickets|sports betting|restaurant reservation|real estate open house)\b/i;
const PRIVATE_PATH = /\/(?:checkout|cart|account|login|sign-?in|profile|people|search)(?:\/|$)/i;
const TRACKING_PARAMS = /^(?:utm_[^=]+|gclid|fbclid|mc_[^=]+|ref)$/i;

export type WebDiscoveryConfig = {
  enabled: boolean;
  maxQueries: number;
  maxResults: number;
  maxFetches: number;
  maxPagesPerDomain: number;
  allowedRegions: string[];
  blockedDomains: string[];
  userAgent: string;
  refineQueries: boolean;
};

export type SearchResult = { url: string; title?: string; publishedDate?: string; highlights?: string[] };
export interface WebSearchProvider { search(query: string, options: { numResults: number; excludedDomains: string[] }): Promise<SearchResult[]>; }

export class ExaSearchProvider implements WebSearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, options: { numResults: number; excludedDomains: string[] }) {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ query, type: "auto", numResults: options.numResults, excludeDomains: options.excludedDomains, contents: { highlights: true } }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Exa search returned ${response.status}`);
    const payload = await response.json() as { results?: SearchResult[] };
    return (payload.results ?? []).map((result) => ({ ...result, highlights: result.highlights?.slice(0, 3) }));
  }
}

const numberSetting = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
};

export function getWebDiscoveryConfig(env: Partial<NodeJS.ProcessEnv> = process.env): WebDiscoveryConfig {
  const split = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return {
    enabled: env.WEB_DISCOVERY_ENABLED === "true",
    maxQueries: numberSetting(env.WEB_DISCOVERY_MAX_QUERIES, 3, 6),
    maxResults: numberSetting(env.WEB_DISCOVERY_MAX_RESULTS, 18, 30),
    maxFetches: numberSetting(env.WEB_DISCOVERY_MAX_FETCHES, 6, 15),
    maxPagesPerDomain: numberSetting(env.WEB_DISCOVERY_MAX_PAGES_PER_DOMAIN, 1, 2),
    allowedRegions: split(env.WEB_DISCOVERY_ALLOWED_REGIONS),
    blockedDomains: [...new Set([...DEFAULT_BLOCKED_DOMAINS, ...split(env.WEB_DISCOVERY_BLOCKED_DOMAINS)])],
    userAgent: env.WEB_DISCOVERY_USER_AGENT || "MEETOpportunityBot/1.0 (+https://meet.example.com/bot)",
    refineQueries: env.WEB_DISCOVERY_REFINE_QUERIES === "true",
  };
}

export function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch { return null; }
}

const domainOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
const domainMatches = (domain: string, blocked: string) => domain === blocked || domain.endsWith(`.${blocked}`);

export function candidateRejectionReason(url: string, config: WebDiscoveryConfig) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return "URL is not a public HTTP(S) page.";
  const parsed = new URL(normalizedUrl);
  const domain = domainOf(normalizedUrl);
  if (config.blockedDomains.some((blocked) => domainMatches(domain, blocked))) return "Blocked domain or login-dependent social source.";
  if (PRIVATE_PATH.test(parsed.pathname) || /(?:checkout|cart|login|sign in|my account)/i.test(parsed.href)) return "Checkout, login, private-profile, or generic search page.";
  if (/\.(?:pdf|zip|docx?|xlsx?)$/i.test(parsed.pathname)) return "Unsupported document candidate; MEET only fetches public event pages.";
  return null;
}

export function buildDiscoveryQueries(profile: UserProfile, config: Pick<WebDiscoveryConfig, "maxQueries">, now = new Date()) {
  const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now);
  const followingMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const dateWindow = `${month} or ${followingMonth}`;
  const location = profile.formatPreference === "online" ? "online" : profile.location;
  const topic = [...profile.interests, ...profile.skills].filter(Boolean).slice(0, 3).join(" ") || "technology";
  const goalWords = profile.goals.split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 4).slice(0, 3).join(" ");
  const formatHint = profile.formatPreference === "online" ? "online virtual" : profile.formatPreference === "in-person" ? "in person" : "upcoming";
  const queries = [
    `${topic} developer events ${location} ${dateWindow}`,
    `${profile.interests[0] || "technology"} workshop ${location} upcoming ${dateWindow}`,
    `hackathon ${location} ${profile.careerStage} upcoming ${dateWindow}`,
    `site:*.edu computer science events ${profile.location} ${dateWindow}`,
    `professional networking events ${location} ${topic} ${dateWindow}`,
    `${goalWords || "career growth"} ${formatHint} demo day conference ${location} ${dateWindow}`,
  ];
  return [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()))].slice(0, config.maxQueries);
}

export function selectCandidates(results: Array<SearchResult & { query: string }>, config: Pick<WebDiscoveryConfig, "maxResults" | "maxFetches" | "maxPagesPerDomain" | "blockedDomains">) {
  const candidates: DiscoveryCandidate[] = [];
  const selected: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  for (const result of results.slice(0, config.maxResults)) {
    const normalizedUrl = normalizeUrl(result.url);
    const reason = candidateRejectionReason(result.url, { ...getWebDiscoveryConfig({}), ...config, enabled: true, allowedRegions: [], userAgent: "MEETOpportunityBot/1.0", refineQueries: false });
    const domain = normalizedUrl ? domainOf(normalizedUrl) : "invalid";
    const candidate: DiscoveryCandidate = { url: result.url, normalizedUrl: normalizedUrl ?? result.url, domain, title: result.title, publishedDate: result.publishedDate, highlights: result.highlights, query: result.query, decision: "skipped", reason: reason ?? undefined };
    if (reason) { candidates.push(candidate); continue; }
    if (seen.has(normalizedUrl!)) { candidate.reason = "Duplicate normalized URL."; candidates.push(candidate); continue; }
    if (selected.length >= config.maxFetches) { candidate.reason = `Total fetch budget (${config.maxFetches}) reached.`; candidates.push(candidate); continue; }
    if ((perDomain.get(domain) ?? 0) >= config.maxPagesPerDomain) { candidate.reason = `Per-domain budget (${config.maxPagesPerDomain}) reached.`; candidates.push(candidate); continue; }
    seen.add(normalizedUrl!); perDomain.set(domain, (perDomain.get(domain) ?? 0) + 1); candidate.decision = "selected"; candidate.reason = undefined;
    selected.push(candidate); candidates.push(candidate);
  }
  return { selected, candidates };
}

type RobotsDecision = { decision: "allowed" | "disallowed" | "unavailable"; reason: string };

export function robotsAllows(robotsText: string, targetUrl: string, userAgent: string) {
  const targetPath = new URL(targetUrl).pathname || "/";
  const groups: { agents: string[]; rules: { type: "allow" | "disallow"; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { type: "allow" | "disallow"; path: string }[] };
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!match) continue;
    const field = match[1].toLowerCase(); const value = match[2].trim();
    if (field === "user-agent") { if (group.agents.length && group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; } group.agents.push(value.toLowerCase()); }
    if ((field === "allow" || field === "disallow") && group.agents.length && value) group.rules.push({ type: field, path: value });
  }
  if (group.agents.length) groups.push(group);
  const agent = userAgent.toLowerCase().split(/[ /]/)[0];
  const matching = groups.filter((item) => item.agents.includes(agent) || item.agents.includes("*"));
  const rules = matching.flatMap((item) => item.rules).filter((rule) => targetPath.startsWith(rule.path.replace(/\*.*$/, "")));
  if (!rules.length) return true;
  rules.sort((a, b) => b.path.length - a.path.length || (a.type === "allow" ? -1 : 1));
  return rules[0].type === "allow";
}

async function robotsDecision(url: string, userAgent: string, cache: Map<string, RobotsDecision>) {
  const origin = new URL(url).origin;
  const cached = cache.get(origin); if (cached) return cached;
  try {
    const response = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": userAgent }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (response.status === 404) { const decision = { decision: "allowed" as const, reason: "No robots.txt found; default allow." }; cache.set(origin, decision); return decision; }
    if (!response.ok) { const decision = { decision: "unavailable" as const, reason: `robots.txt returned ${response.status}; skipped conservatively.` }; cache.set(origin, decision); return decision; }
    const allowed = robotsAllows(await response.text(), url, userAgent);
    const decision = allowed ? { decision: "allowed" as const, reason: "robots.txt allows this path." } : { decision: "disallowed" as const, reason: "robots.txt disallows this path." };
    cache.set(origin, decision); return decision;
  } catch { const decision = { decision: "unavailable" as const, reason: "robots.txt could not be checked; skipped conservatively." }; cache.set(origin, decision); return decision; }
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
class DomainRateLimiter {
  private readonly nextAllowed = new Map<string, number>();
  async wait(domain: string) { const waitFor = (this.nextAllowed.get(domain) ?? 0) - Date.now(); if (waitFor > 0) await delay(waitFor); this.nextAllowed.set(domain, Date.now() + 350); }
}

async function fetchPage(url: string, userAgent: string, limiter: DomainRateLimiter) {
  const domain = domainOf(url); let lastError = "Page fetch failed.";
  for (let attempt = 0; attempt < 1; attempt += 1) {
    try {
      await limiter.wait(domain);
      const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/calendar,application/xml;q=0.9,*/*;q=0.2" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (response.status >= 300 && response.status < 400) throw new Error("Redirected candidate skipped so its destination can be separately screened for robots and policy compliance.");
      if (response.ok) {
        const text = (await response.text()).slice(0, 900_000);
        const canonicalHref = text.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? text.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];
        let canonicalUrl = normalizeUrl(response.url) ?? url;
        if (canonicalHref) { try { const resolved = new URL(canonicalHref, response.url); if (resolved.origin === new URL(response.url).origin) canonicalUrl = normalizeUrl(resolved.toString()) ?? canonicalUrl; } catch { /* keep fetched candidate URL */ } }
        return { url: canonicalUrl, contentType: response.headers.get("content-type") ?? "", text };
      }
      lastError = `Page returned ${response.status}.`; if (response.status < 500) break;
    } catch (error) { lastError = error instanceof Error ? error.message : "Page fetch failed."; }
    await delay(100);
  }
  throw new Error(lastError);
}

const cleanHtml = (value: string) => value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const titleFromHtml = (value: string) => cleanHtml(value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Event page");
const stableId = (value: string) => { let hash = 5381; for (const char of value) hash = ((hash << 5) + hash) ^ char.charCodeAt(0); return (hash >>> 0).toString(36); };
const validDate = (value: string | undefined) => Boolean(value && !Number.isNaN(Date.parse(value)));

function eventFormat(input: unknown, hint = ""): EventFormat {
  const value = `${typeof input === "string" ? input : ""} ${hint}`.toLowerCase();
  if (/hybrid/.test(value)) return "hybrid";
  if (/online|virtual|zoom|remote/.test(value)) return "online";
  return "in-person";
}
function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : []; }
function eventNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(eventNodes);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>; const type = record["@type"];
  const isEvent = stringArray(type).some((item) => item.toLowerCase() === "event");
  return [...(isEvent ? [record] : []), ...Object.values(record).flatMap(eventNodes)];
}
function locationFromSchema(location: unknown) {
  if (!location || typeof location !== "object") return {};
  const entry = location as Record<string, unknown>;
  const address = typeof entry.address === "object" && entry.address ? Object.values(entry.address as Record<string, unknown>).filter((item): item is string => typeof item === "string").join(", ") : stringValue(entry.address);
  const geo = entry.geo as Record<string, unknown> | undefined;
  return { venue: stringValue(entry.name), address, latitude: Number(geo?.latitude) || undefined, longitude: Number(geo?.longitude) || undefined };
}

export function haversineMiles(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(latitudeB - latitudeA); const dLon = radians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type ExtractedCandidate = {
  title?: string | null; description?: string | null; startsAt?: string | null; endsAt?: string | null; timezone?: string | null;
  source?: string | null; sourceUrl?: string | null; registrationUrl?: string | null; format?: EventFormat; venue?: string | null; address?: string | null;
  latitude?: number | null; longitude?: number | null; category?: string | null; tags?: string[]; evidence?: string[]; extractionConfidence?: number;
  provenance?: Partial<EventProvenance>;
};

export function validateExtractedEvent(input: ExtractedCandidate, sourceUrl: string, profile: UserProfile, now = new Date(), allowedRegions: string[] = []) {
  const normalizedSource = normalizeUrl(input.sourceUrl ?? sourceUrl);
  const startsAt = input.startsAt ?? undefined;
  const endsAt = input.endsAt ?? undefined;
  if (!input.title?.trim()) return { event: null, reason: "Rejected extraction: title is missing." };
  if (!validDate(startsAt) || new Date(startsAt as string).getTime() <= now.getTime()) return { event: null, reason: "Rejected extraction: date is missing, invalid, or not future." };
  if (!normalizedSource) return { event: null, reason: "Rejected extraction: source URL is invalid." };
  const evidence = (input.evidence ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  if (!evidence.length) return { event: null, reason: "Rejected extraction: no page evidence supports the event." };
  const sourceDomain = domainOf(normalizedSource);
  const latitude = typeof input.latitude === "number" && Number.isFinite(input.latitude) ? input.latitude : undefined;
  const longitude = typeof input.longitude === "number" && Number.isFinite(input.longitude) ? input.longitude : undefined;
  const format = input.format ?? eventFormat(`${input.venue ?? ""} ${input.address ?? ""} ${input.description ?? ""}`);
  const hasProfileCoordinates = Number.isFinite(profile.latitude) && Number.isFinite(profile.longitude) && (Math.abs(profile.latitude) > 0.001 || Math.abs(profile.longitude) > 0.001);
  const distanceMiles = hasProfileCoordinates && latitude != null && longitude != null ? haversineMiles(profile.latitude, profile.longitude, latitude, longitude) : null;
  if (format === "in-person" && distanceMiles != null && distanceMiles > profile.travelRadius) return { event: null, reason: `Rejected extraction: ${distanceMiles.toFixed(1)} mi is outside the ${profile.travelRadius}-mi radius.` };
  if (profile.formatPreference === "online" && format === "in-person") return { event: null, reason: "Rejected extraction: profile is online-only." };
  const address = input.address?.toLowerCase() ?? "";
  if (format !== "online" && address && allowedRegions.length && !allowedRegions.some((region) => address.includes(region.toLowerCase()))) return { event: null, reason: "Rejected extraction: known address is outside WEB_DISCOVERY_ALLOWED_REGIONS." };
  const titleAndCategory = `${input.title} ${input.category ?? ""} ${sourceDomain}`;
  if (IRRELEVANT_TERMS.test(titleAndCategory)) return { event: null, reason: "Rejected extraction: clearly outside professional-opportunity scope." };
  const registrationUrl = input.registrationUrl ? normalizeUrl(input.registrationUrl) ?? undefined : undefined;
  const event: Opportunity = {
    id: `web-${stableId(`${normalizedSource}-${input.title}-${startsAt}`)}`,
    title: input.title.trim(), source: input.source?.trim() || sourceDomain, sourceType: "web-discovery", url: normalizedSource,
    description: input.description?.trim() || "", startsAt: new Date(startsAt as string).toISOString(), endsAt: validDate(endsAt) ? new Date(endsAt as string).toISOString() : undefined,
    timezone: input.timezone ?? undefined, format, venue: input.venue?.trim() || undefined, address: input.address?.trim() || undefined, latitude: latitude ?? null, longitude: longitude ?? null, distanceMiles,
    category: input.category?.trim() || "Event", tags: input.tags?.filter(Boolean).slice(0, 12) ?? [],
    provenance: { sourceDomain, sourceUrl: normalizedSource, registrationUrl, extractionMethod: input.provenance?.extractionMethod ?? "llm", extractionConfidence: Math.max(0, Math.min(1, input.extractionConfidence ?? 0.7)), evidence, robotsDecision: input.provenance?.robotsDecision },
  };
  return { event, reason: null };
}

function extractStructuredEvents(html: string, sourceUrl: string, profile: UserProfile, allowedRegions: string[] = []) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const events: Opportunity[] = []; const rejected: string[] = [];
  for (const script of scripts) {
    try {
      for (const node of eventNodes(JSON.parse(script))) {
        const location = locationFromSchema(node.location); const organizer = node.organizer as Record<string, unknown> | undefined;
        const validated = validateExtractedEvent({
          title: stringValue(node.name), description: stringValue(node.description), startsAt: stringValue(node.startDate), endsAt: stringValue(node.endDate) || undefined,
          source: stringValue(organizer?.name) || undefined, sourceUrl, registrationUrl: stringValue(node.url) || undefined, format: eventFormat(node.eventAttendanceMode, `${stringValue(node.location)} ${stringValue(node.description)}`),
          venue: location.venue, address: location.address, latitude: location.latitude, longitude: location.longitude, category: stringValue(node.eventCategory) || "Event", tags: stringArray(node.keywords), extractionConfidence: 0.98,
          evidence: [`JSON-LD Event: ${stringValue(node.name)}; starts ${stringValue(node.startDate)}`], provenance: { extractionMethod: "structured", sourceDomain: domainOf(sourceUrl), sourceUrl, evidence: [] },
        }, sourceUrl, profile, new Date(), allowedRegions);
        if (validated.event) events.push(validated.event); else if (validated.reason) rejected.push(validated.reason);
      }
    } catch { /* malformed JSON-LD is ignored and may use the LLM fallback */ }
  }
  return { events, rejected };
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? cleanHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")) : "";
}

function extractFeedEvents(xml: string, sourceUrl: string, profile: UserProfile, allowedRegions: string[] = []) {
  const entries = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  const events: Opportunity[] = []; const rejected: string[] = [];
  for (const entry of entries) {
    const title = xmlValue(entry, "title"); const description = xmlValue(entry, "description") || xmlValue(entry, "content") || xmlValue(entry, "summary");
    const startsAt = xmlValue(entry, "event:start_time") || xmlValue(entry, "startDate") || xmlValue(entry, "dtstart");
    const link = entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || xmlValue(entry, "link") || sourceUrl;
    const validated = validateExtractedEvent({ title, description, startsAt, sourceUrl: link, format: eventFormat(`${title} ${description}`), category: "Community event", tags: [], extractionConfidence: 0.93, evidence: [`RSS/Atom entry: ${title}; date ${startsAt}`], provenance: { extractionMethod: "structured" } }, sourceUrl, profile, new Date(), allowedRegions);
    if (validated.event) events.push(validated.event); else if (validated.reason) rejected.push(validated.reason);
  }
  return { events, rejected };
}

function parseIcsDate(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/); if (!match) return "";
  const [, year, month, day, hour = "00", minute = "00", second = "00", utc] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ? "Z" : ""}`;
}

function extractIcsEvents(ics: string, sourceUrl: string, profile: UserProfile, allowedRegions: string[] = []) {
  const blocks = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? []; const events: Opportunity[] = []; const rejected: string[] = [];
  for (const block of blocks) {
    const property = (name: string) => block.match(new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, "im"))?.[1].trim() ?? "";
    const title = property("SUMMARY"); const startsAt = parseIcsDate(property("DTSTART")); const endsAt = parseIcsDate(property("DTEND")); const location = property("LOCATION"); const description = property("DESCRIPTION").replace(/\\n/g, " "); const registrationUrl = property("URL");
    const validated = validateExtractedEvent({ title, description, startsAt, endsAt: endsAt || undefined, sourceUrl, registrationUrl: registrationUrl || undefined, format: eventFormat(`${location} ${description}`), venue: location || undefined, category: "Calendar event", tags: [], extractionConfidence: 0.96, evidence: [`ICS VEVENT: ${title}; DTSTART ${property("DTSTART")}`], provenance: { extractionMethod: "structured" } }, sourceUrl, profile, new Date(), allowedRegions);
    if (validated.event) events.push(validated.event); else if (validated.reason) rejected.push(validated.reason);
  }
  return { events, rejected };
}

function extractOpenGraphEvent(html: string, sourceUrl: string, profile: UserProfile, allowedRegions: string[] = []) {
  const metadata = Object.fromEntries([...html.matchAll(/<meta\s+(?:property|name)=["']([^"']+)["']\s+content=["']([^"']*)["'][^>]*>/gi)].map((match) => [match[1].toLowerCase(), cleanHtml(match[2])]));
  const startsAt = metadata["event:start_time"] || metadata["og:event:start_time"] || metadata["event:start"];
  if (!startsAt) return { events: [] as Opportunity[], rejected: [] as string[] };
  const validated = validateExtractedEvent({ title: metadata["og:title"] || metadata.title, description: metadata["og:description"] || metadata.description, startsAt, sourceUrl, registrationUrl: metadata["og:url"], format: eventFormat(`${metadata["og:title"] ?? ""} ${metadata["og:description"] ?? ""}`), category: "Event", tags: [], extractionConfidence: 0.8, evidence: [`Open Graph event:start_time: ${startsAt}`], provenance: { extractionMethod: "structured" } }, sourceUrl, profile, new Date(), allowedRegions);
  return validated.event ? { events: [validated.event], rejected: [] as string[] } : { events: [] as Opportunity[], rejected: validated.reason ? [validated.reason] : [] };
}

export function toProvenanceRecord(event: Opportunity) {
  const provenance = event.provenance;
  return provenance ? {
    source_domain: provenance.sourceDomain, source_url: provenance.sourceUrl, registration_url: provenance.registrationUrl ?? null,
    discovery_query: provenance.discoveryQuery ?? null, extraction_method: provenance.extractionMethod,
    extraction_confidence: provenance.extractionConfidence ?? null, evidence_snippets: provenance.evidence,
    robots_decision: provenance.robotsDecision ?? null,
  } : null;
}

export type WebDiscoveryResult = { events: Opportunity[]; ledger: LedgerEntry[]; diagnostics: DiscoveryDiagnostics };

export async function runWebDiscovery(profile: UserProfile, provider: WebSearchProvider = new ExaSearchProvider(process.env.EXA_API_KEY || ""), config = getWebDiscoveryConfig()): Promise<WebDiscoveryResult> {
  config = { ...config, maxQueries: Math.min(config.maxQueries, 4), maxResults: Math.min(config.maxResults, 20), maxFetches: Math.min(config.maxFetches, 8), maxPagesPerDomain: 1 };
  const diagnostics: DiscoveryDiagnostics = { enabled: config.enabled, queries: [], candidates: [], fetched: 0, structuredExtractions: 0, llmExtractions: 0, rejectedEvents: [] };
  const ledger: LedgerEntry[] = [];
  if (!config.enabled) return { events: [], diagnostics, ledger: [{ id: "web-disabled", kind: "source", status: "skipped", title: "Web discovery", detail: "Disabled by WEB_DISCOVERY_ENABLED.", at: "just now" }] };
  if (!process.env.EXA_API_KEY && provider instanceof ExaSearchProvider) throw new Error("Web discovery needs EXA_API_KEY.");
  const deterministic = buildDiscoveryQueries(profile, config);
  let queries: { query: string; origin: "deterministic" | "llm-refined" }[] = deterministic.map((query) => ({ query, origin: "deterministic" }));
  if (config.refineQueries && groqConfigured()) {
    const refined = await refineDiscoveryQueriesWithGroq(profile, deterministic);
    if (refined.length) {
      const combined = new Map<string, { query: string; origin: "deterministic" | "llm-refined" }>();
      refined.forEach((query) => combined.set(query.toLowerCase(), { query, origin: "llm-refined" }));
      queries.forEach((entry) => combined.set(entry.query.toLowerCase(), entry));
      queries = [...combined.values()].slice(0, config.maxQueries);
    }
  }
  diagnostics.queries = queries;
  ledger.push({ id: "web-queries", kind: "source", status: "complete", title: "Web discovery queries", detail: `${queries.length} bounded ${config.refineQueries && groqConfigured() ? "LLM-diversified" : "deterministic"} queries: ${queries.map((entry) => `“${entry.query}”`).join(" · ")}`, at: "just now" });
  const perQuery = Math.max(1, Math.ceil(config.maxResults / Math.max(1, queries.length)));
  const resultSets = await Promise.allSettled(queries.map(async ({ query }) => ({ query, results: await provider.search(query, { numResults: perQuery, excludedDomains: config.blockedDomains }) })));
  const rawResults: Array<SearchResult & { query: string }> = [];
  resultSets.forEach((result, index) => { if (result.status === "fulfilled") rawResults.push(...result.value.results.map((candidate) => ({ ...candidate, query: result.value.query }))); else ledger.push({ id: `web-search-error-${index}`, kind: "source", status: "attention", title: "Web discovery search failed", detail: result.reason instanceof Error ? result.reason.message : "Search provider request failed.", at: "just now" }); });
  const { selected, candidates } = selectCandidates(rawResults, config);
  diagnostics.candidates = candidates;
  const skipped = candidates.filter((candidate) => candidate.decision === "skipped");
  ledger.push({ id: "web-candidates", kind: "source", status: "complete", title: "Web candidates screened", detail: `${rawResults.length} results found; ${selected.length} eligible pages selected. ${skipped.length} skipped by URL, domain, duplicate, or budget rules.`, at: "just now" });
  for (const [index, candidate] of skipped.entries()) ledger.push({ id: `web-skip-${index}-${stableId(candidate.normalizedUrl)}`, kind: "source", status: "skipped", title: candidate.domain, detail: candidate.reason ?? "Candidate skipped.", at: "just now" });
  const robotsCache = new Map<string, RobotsDecision>(); const limiter = new DomainRateLimiter(); const events: Opportunity[] = [];
  await Promise.allSettled(selected.map(async (candidate) => {
    const robot = await robotsDecision(candidate.normalizedUrl, config.userAgent, robotsCache);
    if (robot.decision !== "allowed") { candidate.decision = "robots-disallowed"; candidate.reason = robot.reason; ledger.push({ id: `web-robots-${stableId(candidate.normalizedUrl)}`, kind: "source", status: "skipped", title: `robots.txt · ${candidate.domain}`, detail: robot.reason, at: "just now" }); return; }
    try {
      const page = await fetchPage(candidate.normalizedUrl, config.userAgent, limiter); diagnostics.fetched += 1; candidate.normalizedUrl = page.url; candidate.decision = "fetched"; candidate.reason = "Fetched after URL, budget, and robots checks.";
      const jsonLd = extractStructuredEvents(page.text, page.url, profile, config.allowedRegions);
      const feed = /<(?:rss|feed)\b/i.test(page.text) ? extractFeedEvents(page.text, page.url, profile, config.allowedRegions) : { events: [] as Opportunity[], rejected: [] as string[] };
      const ics = /BEGIN:VEVENT/i.test(page.text) || /text\/calendar/i.test(page.contentType) ? extractIcsEvents(page.text, page.url, profile, config.allowedRegions) : { events: [] as Opportunity[], rejected: [] as string[] };
      const openGraph = extractOpenGraphEvent(page.text, page.url, profile, config.allowedRegions);
      const structured = { events: [...jsonLd.events, ...feed.events, ...ics.events, ...openGraph.events], rejected: [...jsonLd.rejected, ...feed.rejected, ...ics.rejected, ...openGraph.rejected] };
      if (structured.events.length) {
        structured.events.forEach((event) => { if (event.provenance) { event.provenance.discoveryQuery = candidate.query; event.provenance.robotsDecision = "allowed"; } });
        diagnostics.structuredExtractions += structured.events.length; events.push(...structured.events);
        ledger.push({ id: `web-structured-${stableId(page.url)}`, kind: "source", status: "complete", title: `Structured event data · ${candidate.domain}`, detail: `${structured.events.length} JSON-LD, feed, ICS, or Open Graph event extraction${structured.events.length === 1 ? "" : "s"} from ${page.url}.`, at: "just now" });
      } else if (groqConfigured()) {
        const extracted = await extractEventsWithGroq({ url: page.url, title: titleFromHtml(page.text), text: cleanHtml(page.text) });
        const validated = extracted.map((item) => validateExtractedEvent({ ...item, source: item.organizer ?? undefined, sourceUrl: page.url, provenance: { extractionMethod: "llm", sourceDomain: domainOf(page.url), sourceUrl: page.url, evidence: [], robotsDecision: "allowed" } }, page.url, profile, new Date(), config.allowedRegions));
        const usable = validated.flatMap((item) => item.event ? [item.event] : []);
        validated.forEach((item) => { if (item.reason) diagnostics.rejectedEvents.push(item.reason); });
        usable.forEach((event) => { if (event.provenance) { event.provenance.discoveryQuery = candidate.query; event.provenance.robotsDecision = "allowed"; } });
        diagnostics.llmExtractions += usable.length; events.push(...usable);
        ledger.push({ id: `web-llm-${stableId(page.url)}`, kind: "source", status: usable.length ? "complete" : "attention", title: `LLM extraction · ${candidate.domain}`, detail: usable.length ? `${usable.length} evidence-backed event${usable.length === 1 ? "" : "s"} extracted with Groq.` : "No evidence-backed events were extracted from this page.", at: "just now" });
      } else {
        diagnostics.rejectedEvents.push("Structured event data was absent and GROQ_API_KEY is unavailable for permitted unstructured extraction.");
        ledger.push({ id: `web-no-llm-${stableId(page.url)}`, kind: "source", status: "skipped", title: `Unstructured page · ${candidate.domain}`, detail: "No structured Event data and GROQ_API_KEY is unavailable; page was not inferred locally.", at: "just now" });
      }
      diagnostics.rejectedEvents.push(...structured.rejected);
    } catch (error) { candidate.decision = "error"; candidate.reason = error instanceof Error ? error.message : "Fetch failed."; ledger.push({ id: `web-fetch-error-${stableId(candidate.normalizedUrl)}`, kind: "source", status: "attention", title: `Fetch failed · ${candidate.domain}`, detail: candidate.reason, at: "just now" }); }
  }));
  for (const [index, reason] of diagnostics.rejectedEvents.entries()) ledger.push({ id: `web-rejected-${index}-${stableId(reason)}`, kind: "source", status: "skipped", title: "Extracted event rejected", detail: reason, at: "just now" });
  ledger.unshift({ id: "web-discovery", kind: "source", status: "complete", title: "Web discovery", detail: `${diagnostics.fetched} public pages fetched within ${config.maxFetches}-page / ${config.maxPagesPerDomain}-per-domain budgets; ${events.length} evidence-backed events passed validation.`, at: "just now" });
  return { events, ledger, diagnostics };
}
