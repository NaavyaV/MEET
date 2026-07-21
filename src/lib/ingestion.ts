import { deduplicate } from "./engine";
import { isWithinUpcomingEventWindow } from "./event-window";
import { extractEventsWithGroq, groqConfigured } from "./groq";
import { haversineMiles, validateExtractedEvent, getWebDiscoveryConfig, robotsDecision, runWebDiscovery, WebDiscoveryResult } from "./web-discovery";
import { LedgerEntry, Opportunity, UserProfile } from "./types";

type SourceStatus = { name: string; count: number; status: "complete" | "skipped" | "attention" };
type SourceLoadResult = { events: Opportunity[]; ledger?: LedgerEntry[]; discovery?: WebDiscoveryResult["diagnostics"] };
const MAX_EVENTS_PER_FEED = 50;
const MAX_STRUCTURED_EVENTS_PER_REFRESH = 90;

function stripHtml(value: string) {
  return value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function textIn(xml: string, tag: string) { const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return match ? stripHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")) : ""; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72); }
function inferFormat(value: string): Opportunity["format"] { return /hybrid/i.test(value) ? "hybrid" : /online|virtual|zoom|remote/i.test(value) ? "online" : "in-person"; }
function parseIcsDate(value: string) { const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/); if (!match) return null; const [, year, month, day, hour = "00", minute = "00", second = "00", utc] = match; const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ? "Z" : ""}`; const date = new Date(iso); return Number.isNaN(date.getTime()) ? null : date; }
function icsField(block: string, field: string) { return block.match(new RegExp(`^${field}(?:;[^:]*)?:(.+)$`, "im"))?.[1].replace(/\\n/g, " ").trim() ?? ""; }
function finiteCoordinate(value: string) { const coordinate = Number(value); return Number.isFinite(coordinate) ? coordinate : null; }
function eventDateInText(value: string) {
  const match = value.match(/\b20\d{2}-\d{2}-\d{2}(?:[T\s][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,?\s+20\d{2})?\b/i)?.[0];
  return match ? new Date(match) : null;
}
function locationDistance(profile: UserProfile | undefined, latitude: number | null, longitude: number | null) { return profile && latitude != null && longitude != null ? haversineMiles(profile.latitude, profile.longitude, latitude, longitude) : null; }

export function parseIcs(ics: string, sourceUrl: string, now = new Date(), profile?: UserProfile): Opportunity[] {
  const sourceDomain = new URL(sourceUrl).hostname; const blocks = ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? [];
  return blocks.flatMap((block, index): Opportunity[] => {
    const title = icsField(block, "SUMMARY"); const start = parseIcsDate(icsField(block, "DTSTART")); const end = parseIcsDate(icsField(block, "DTEND")); const location = icsField(block, "LOCATION"); const description = icsField(block, "DESCRIPTION"); const url = icsField(block, "URL") || sourceUrl;
    const [latitudeText, longitudeText] = icsField(block, "GEO").split(/[;,]/); const latitude = finiteCoordinate(latitudeText); const longitude = finiteCoordinate(longitudeText); const format = inferFormat(`${location} ${description}`); const distanceMiles = locationDistance(profile, latitude, longitude);
    if (!title || !start || !isWithinUpcomingEventWindow(start, now)) return [];
    return [{ id: `ics-${slug(title)}-${start.getTime()}-${index}`, title, source: sourceDomain, sourceType: "rss", url, description, startsAt: start.toISOString(), endsAt: end?.toISOString(), format, venue: location || undefined, latitude, longitude, distanceMiles, category: "Calendar event", tags: [], provenance: { sourceDomain, sourceUrl, extractionMethod: "rss", extractionConfidence: 1, evidence: [`ICS VEVENT: ${title}; DTSTART ${icsField(block, "DTSTART")}`] } }];
  });
}

export function parseRss(xml: string, sourceUrl: string, now = new Date(), profile?: UserProfile): Opportunity[] {
  const entries = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return entries.flatMap((entry, index): Opportunity[] => {
    const title = textIn(entry, "title"); const description = textIn(entry, "description") || textIn(entry, "content") || textIn(entry, "summary");
    const startsAt = textIn(entry, "event:start_time") || textIn(entry, "event:start") || textIn(entry, "startDate") || textIn(entry, "dtstart"); const link = entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || textIn(entry, "link") || sourceUrl;
    const start = startsAt ? new Date(startsAt) : eventDateInText(`${title} ${description}`) ?? new Date(textIn(entry, "pubDate") || textIn(entry, "updated") || textIn(entry, "published"));
    const latitude = finiteCoordinate(textIn(entry, "geo:lat") || textIn(entry, "latitude")); const longitude = finiteCoordinate(textIn(entry, "geo:long") || textIn(entry, "longitude")); const format = inferFormat(`${title} ${description}`); const distanceMiles = locationDistance(profile, latitude, longitude);
    if (!title || !start || !isWithinUpcomingEventWindow(start, now)) return [];
    return [{ id: `rss-${slug(title)}-${index}`, title, source: "Community RSS feed", sourceType: "rss", url: link, description: description || "", startsAt: start.toISOString(), format, latitude, longitude, distanceMiles, category: "Community event", tags: [], provenance: { sourceDomain: new URL(sourceUrl).hostname, sourceUrl, extractionMethod: "rss", extractionConfidence: 1, evidence: [`RSS/Atom item: ${title}; event date ${start.toISOString()}`] } }];
  });
}

async function rssSource(profile: UserProfile): Promise<SourceLoadResult> {
  const urls = (process.env.MEET_RSS_FEED_URL ?? "").split(",").map((url) => url.trim()).filter(Boolean).slice(0, 6); if (!urls.length) return { events: [] };
  const results = await Promise.allSettled(urls.map(async (sourceUrl) => { const response = await fetch(sourceUrl, { next: { revalidate: 0 }, signal: AbortSignal.timeout(7000) }); if (!response.ok) throw new Error(`${sourceUrl} returned ${response.status}`); const body = await response.text(); const parsed = /BEGIN:VEVENT/i.test(body) || /text\/calendar/i.test(response.headers.get("content-type") ?? "") || /\.ics(?:$|\?)/i.test(sourceUrl) ? parseIcs(body, sourceUrl, new Date(), profile) : parseRss(body, sourceUrl, new Date(), profile); return parsed.sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, MAX_EVENTS_PER_FEED); }));
  const failed = results.find((result) => result.status === "rejected"); if (failed && results.every((result) => result.status === "rejected")) throw failed.reason;
  return { events: results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, MAX_STRUCTURED_EVENTS_PER_REFRESH) };
}

async function crawlerSource(profile: UserProfile): Promise<SourceLoadResult> {
  const urls = (process.env.CRAWL_SEED_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean).slice(0, 3); if (!urls.length) return { events: [] }; if (!groqConfigured()) throw new Error("Curated crawler needs GROQ_API_KEY for permitted-page extraction");
  const config = getWebDiscoveryConfig(); const robotsCache = new Map<string, { decision: "allowed" | "disallowed" | "unavailable"; reason: string }>();
  const pages = (await Promise.all(urls.map(async (url) => {
    const robot = await robotsDecision(url, config.userAgent, robotsCache);
    if (robot.decision !== "allowed") return null;
    const response = await fetch(url, { next: { revalidate: 0 }, headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error(`${url} returned ${response.status}`); const html = await response.text(); return { url, title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Event page", text: stripHtml(html) };
  }))).filter((page): page is { url: string; title: string; text: string } => Boolean(page));
  const groups = await Promise.all(pages.map(async (page) => (await extractEventsWithGroq(page)).flatMap((event) => { const validated = validateExtractedEvent({ ...event, source: event.organizer ?? "Permitted seed source", sourceUrl: page.url, provenance: { sourceDomain: new URL(page.url).hostname, sourceUrl: page.url, extractionMethod: "llm", evidence: [], robotsDecision: "allowed" } }, page.url, profile); return validated.event ? [{ ...validated.event, sourceType: "curated-crawler" as const }] : []; })));
  return { events: groups.flat() };
}

export async function ingestOpportunities(profile: UserProfile) {
  const webConfig = getWebDiscoveryConfig();
  const jobs: { name: string; configured: boolean; missingDetail: string; load: () => Promise<SourceLoadResult> }[] = [
    { name: "Eventbrite API", configured: false, missingDetail: "Direct Eventbrite location search is retired by Eventbrite; public Eventbrite listings can still be discovered through web search.", load: async () => ({ events: [] }) },
    { name: "Community RSS feed", configured: Boolean(process.env.MEET_RSS_FEED_URL), missingDetail: "Not configured — add MEET_RSS_FEED_URL.", load: () => rssSource(profile) },
    { name: "Permitted seed crawler", configured: Boolean(process.env.CRAWL_SEED_URLS), missingDetail: "Not configured — add up to three CRAWL_SEED_URLS.", load: () => crawlerSource(profile) },
    { name: "Web discovery", configured: webConfig.enabled, missingDetail: "Disabled — set WEB_DISCOVERY_ENABLED=true and provide EXA_API_KEY.", load: async () => { const result = await runWebDiscovery(profile, undefined, webConfig); return { events: result.events, ledger: result.ledger, discovery: result.diagnostics }; } },
  ];
  const started = Date.now(); const results = await Promise.allSettled(jobs.map((job) => job.load())); const events: Opportunity[] = []; const sources: SourceStatus[] = []; const ledger: LedgerEntry[] = []; let discovery: WebDiscoveryResult["diagnostics"] | undefined;
  results.forEach((result, index) => {
    const job = jobs[index];
    if (!job.configured) { sources.push({ name: job.name, count: 0, status: "skipped" }); ledger.push({ id: `source-${index}`, kind: "source", status: "skipped", title: job.name, detail: job.missingDetail, at: "just now" }); return; }
    if (result.status === "fulfilled") { events.push(...result.value.events); sources.push({ name: job.name, count: result.value.events.length, status: "complete" }); ledger.push({ id: `source-${index}`, kind: "source", status: "complete", title: job.name, detail: `${result.value.events.length} event${result.value.events.length === 1 ? "" : "s"} normalized.`, at: "just now", duration: `${((Date.now() - started) / 1000).toFixed(1)}s` }); ledger.push(...(result.value.ledger ?? [])); discovery ??= result.value.discovery; return; }
    sources.push({ name: job.name, count: 0, status: "attention" }); ledger.push({ id: `source-${index}`, kind: "source", status: "attention", title: job.name, detail: result.reason instanceof Error ? result.reason.message : "The source could not be reached.", at: "just now" });
  });
  const deduped = deduplicate(events); ledger.push({ id: "dedup", kind: "dedup", status: "complete", title: "Deterministic deduplication", detail: deduped.decisions.length ? deduped.decisions.join(" ") : "No duplicate candidates crossed the auto-merge threshold.", at: "just now", duration: "<0.1s" });
  return { events: deduped.events, sources, ledger, discovery };
}
