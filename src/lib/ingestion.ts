import { deduplicate } from "./engine";
import { extractEventsWithGroq, groqConfigured } from "./groq";
import { validateExtractedEvent, getWebDiscoveryConfig, runWebDiscovery, WebDiscoveryResult } from "./web-discovery";
import { LedgerEntry, Opportunity, UserProfile } from "./types";

type SourceStatus = { name: string; count: number; status: "complete" | "skipped" | "attention" };
type SourceLoadResult = { events: Opportunity[]; ledger?: LedgerEntry[]; discovery?: WebDiscoveryResult["diagnostics"] };

function stripHtml(value: string) {
  return value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function textIn(xml: string, tag: string) { const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return match ? stripHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")) : ""; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72); }
function inferFormat(value: string): Opportunity["format"] { return /hybrid/i.test(value) ? "hybrid" : /online|virtual|zoom|remote/i.test(value) ? "online" : "in-person"; }
function distanceMiles(latitude: number, longitude: number, eventLatitude: number | null, eventLongitude: number | null) {
  if (eventLatitude == null || eventLongitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat = radians(eventLatitude - latitude); const lon = radians(eventLongitude - longitude);
  const value = Math.sin(lat / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(eventLatitude)) * Math.sin(lon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function parseRss(xml: string, sourceUrl: string): Opportunity[] {
  const entries = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  return entries.flatMap((entry, index): Opportunity[] => {
    const title = textIn(entry, "title"); const description = textIn(entry, "description") || textIn(entry, "content") || textIn(entry, "summary");
    const startsAt = textIn(entry, "pubDate") || textIn(entry, "updated") || textIn(entry, "published"); const link = entry.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || textIn(entry, "link") || sourceUrl;
    if (!title || Number.isNaN(Date.parse(startsAt)) || new Date(startsAt).getTime() <= Date.now()) return [];
    return [{ id: `rss-${slug(title)}-${index}`, title, source: "Community RSS feed", sourceType: "rss", url: link, description: description || "", startsAt: new Date(startsAt).toISOString(), format: inferFormat(`${title} ${description}`), category: "Community event", tags: [], provenance: { sourceDomain: new URL(sourceUrl).hostname, sourceUrl, extractionMethod: "rss", extractionConfidence: 1, evidence: [`RSS/Atom item: ${title}; published ${startsAt}`] } }];
  });
}

async function eventbriteSource(profile: UserProfile): Promise<SourceLoadResult> {
  const token = process.env.EVENTBRITE_API_KEY || process.env.EVENTBRITE_PRIVATE_TOKEN; if (!token) return { events: [] };
  const url = new URL("https://www.eventbriteapi.com/v3/events/search/"); url.searchParams.set("location.address", profile.location); url.searchParams.set("location.within", `${profile.travelRadius}mi`); url.searchParams.set("expand", "venue,organizer");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 0 } }); if (!response.ok) throw new Error(`Eventbrite returned ${response.status}`);
  const data = await response.json() as { events?: Array<Record<string, unknown>> };
  const events = (data.events ?? []).flatMap((item, index): Opportunity[] => {
    const name = item.name as { text?: string } | undefined; const description = item.description as { text?: string } | undefined; const start = item.start as { utc?: string } | undefined;
    const venue = item.venue as { name?: string; address?: { localized_address_display?: string; latitude?: string; longitude?: string } } | undefined; const organizer = item.organizer as { name?: string } | undefined;
    if (!name?.text || !start?.utc || Number.isNaN(Date.parse(start.utc)) || new Date(start.utc).getTime() <= Date.now()) return [];
    const eventUrl = typeof item.url === "string" ? item.url : "https://www.eventbrite.com/";
    const latitude = Number(venue?.address?.latitude) || null; const longitude = Number(venue?.address?.longitude) || null;
    return [{ id: `eventbrite-${String(item.id ?? index)}`, externalId: String(item.id ?? index), title: name.text, source: organizer?.name ?? "Eventbrite", sourceType: "api", url: eventUrl, description: description?.text ?? "", startsAt: new Date(start.utc).toISOString(), format: inferFormat(`${name.text} ${description?.text ?? ""}`), venue: venue?.name, address: venue?.address?.localized_address_display, latitude, longitude, distanceMiles: distanceMiles(profile.latitude, profile.longitude, latitude, longitude), category: "Event", tags: [], provenance: { sourceDomain: "eventbrite.com", sourceUrl: eventUrl, extractionMethod: "api", extractionConfidence: 1, evidence: [`Eventbrite API event: ${name.text}; starts ${start.utc}; searched near ${profile.location}`] } }];
  });
  return { events };
}

async function rssSource(): Promise<SourceLoadResult> { const feedUrl = process.env.MEET_RSS_FEED_URL; if (!feedUrl) return { events: [] }; const response = await fetch(feedUrl, { next: { revalidate: 0 } }); if (!response.ok) throw new Error(`RSS feed returned ${response.status}`); return { events: parseRss(await response.text(), feedUrl) }; }

async function crawlerSource(profile: UserProfile): Promise<SourceLoadResult> {
  const urls = (process.env.CRAWL_SEED_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean).slice(0, 3); if (!urls.length) return { events: [] }; if (!groqConfigured()) throw new Error("Curated crawler needs GROQ_API_KEY for permitted-page extraction");
  const pages = await Promise.all(urls.map(async (url) => { const response = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error(`${url} returned ${response.status}`); const html = await response.text(); return { url, title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Event page", text: stripHtml(html) }; }));
  const groups = await Promise.all(pages.map(async (page) => (await extractEventsWithGroq(page)).flatMap((event) => { const validated = validateExtractedEvent({ ...event, source: event.organizer ?? "Permitted seed source", sourceUrl: page.url, provenance: { sourceDomain: new URL(page.url).hostname, sourceUrl: page.url, extractionMethod: "llm", evidence: [], robotsDecision: "allowed" } }, page.url, profile); return validated.event ? [{ ...validated.event, sourceType: "curated-crawler" as const }] : []; })));
  return { events: groups.flat() };
}

export async function ingestOpportunities(profile: UserProfile) {
  const webConfig = getWebDiscoveryConfig();
  const jobs: { name: string; configured: boolean; missingDetail: string; load: () => Promise<SourceLoadResult> }[] = [
    { name: "Eventbrite API", configured: Boolean(process.env.EVENTBRITE_API_KEY || process.env.EVENTBRITE_PRIVATE_TOKEN), missingDetail: "Not configured — add EVENTBRITE_API_KEY.", load: () => eventbriteSource(profile) },
    { name: "Community RSS feed", configured: Boolean(process.env.MEET_RSS_FEED_URL), missingDetail: "Not configured — add MEET_RSS_FEED_URL.", load: rssSource },
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
