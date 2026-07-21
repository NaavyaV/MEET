import { describe, expect, it } from "vitest";
import { defaultProfile } from "./demo-data";
import { deduplicate, relevanceFallback } from "./engine";
import { Opportunity } from "./types";
import { buildDiscoveryQueries, getWebDiscoveryConfig, normalizeUrl, robotsAllows, selectCandidates, toProvenanceRecord, validateExtractedEvent } from "./web-discovery";

const config = getWebDiscoveryConfig({ WEB_DISCOVERY_ENABLED: "true", WEB_DISCOVERY_MAX_QUERIES: "6", WEB_DISCOVERY_MAX_RESULTS: "30", WEB_DISCOVERY_MAX_FETCHES: "3", WEB_DISCOVERY_MAX_PAGES_PER_DOMAIN: "2" });
const future = new Date(Date.now() + 86_400_000 * 10).toISOString();

function webEvent(overrides: Partial<Opportunity> = {}): Opportunity {
  return { id: "web-1", title: "AI Education Build Night", source: "example.edu", sourceType: "web-discovery", url: "https://example.edu/events/build-night", description: "A practical AI education workshop.", startsAt: future, format: "in-person", latitude: 41.88, longitude: -87.63, distanceMiles: 1, category: "Workshop", tags: ["AI", "education"], provenance: { sourceDomain: "example.edu", sourceUrl: "https://example.edu/events/build-night", discoveryQuery: "AI events Chicago", extractionMethod: "structured", extractionConfidence: 0.98, evidence: ["JSON-LD Event: AI Education Build Night"] }, ...overrides };
}

describe("web discovery decisions", () => {
  it("builds bounded location-aware queries", () => {
    const queries = buildDiscoveryQueries(defaultProfile, config, new Date("2026-07-21T12:00:00Z"));
    expect(queries).toHaveLength(6);
    expect(queries.join(" ")).toContain("Chicago");
    expect(queries.join(" ")).toContain("July 2026");
  });

  it("normalizes URLs and removes tracking identifiers", () => {
    expect(normalizeUrl("http://WWW.Example.edu/events/?utm_source=mail&b=2&a=1#details")).toBe("https://example.edu/events?a=1&b=2");
    expect(normalizeUrl("mailto:hello@example.edu")).toBeNull();
  });

  it("rejects login and checkout candidates, deduplicates URLs, and enforces domain budgets", () => {
    const candidates = selectCandidates([
      { query: "q", url: "https://events.example.edu/one", title: "One" },
      { query: "q", url: "https://events.example.edu/two", title: "Two" },
      { query: "q", url: "https://events.example.edu/three", title: "Three" },
      { query: "q", url: "https://other.example.edu/checkout", title: "Checkout" },
      { query: "q", url: "https://events.example.edu/one?utm_source=x", title: "Duplicate" },
    ], config);
    expect(candidates.selected).toHaveLength(2);
    expect(candidates.candidates.filter((candidate) => candidate.decision === "skipped").map((candidate) => candidate.reason).join(" ")).toContain("budget");
    expect(candidates.candidates.map((candidate) => candidate.reason).join(" ")).toContain("Checkout");
  });

  it("applies robots decisions without bypassing a disallow rule", () => {
    const robots = "User-agent: MEETOpportunityBot\nDisallow: /private\nAllow: /events\n";
    expect(robotsAllows(robots, "https://example.edu/events/open", "MEETOpportunityBot/1.0")).toBe(true);
    expect(robotsAllows(robots, "https://example.edu/private/event", "MEETOpportunityBot/1.0")).toBe(false);
  });

  it("keeps deterministic relevance available without Groq", () => {
    const match = relevanceFallback(webEvent(), defaultProfile);
    const mismatch = relevanceFallback(webEvent({ title: "Enterprise Sales Breakfast", description: "Account executive prospecting.", tags: ["sales"] }), defaultProfile);
    expect(match).toBeGreaterThan(mismatch);
  });

  it("rejects unsupported extraction and accepts evidence-backed future events", () => {
    expect(validateExtractedEvent({ title: "Missing date", evidence: ["An event"] }, "https://example.edu/events", defaultProfile).event).toBeNull();
    const valid = validateExtractedEvent({ title: "AI workshop", description: "Build with AI", startsAt: future, sourceUrl: "https://example.edu/events/ai", format: "in-person", latitude: 41.88, longitude: -87.63, category: "Workshop", tags: ["AI"], extractionConfidence: 0.9, evidence: ["AI workshop on the event page"], provenance: { extractionMethod: "structured" } }, "https://example.edu/events/ai", defaultProfile);
    expect(valid.event?.provenance?.evidence).toEqual(["AI workshop on the event page"]);
    expect(valid.event?.sourceType).toBe("web-discovery");
  });

  it("rejects evidence-backed events more than 62 days away", () => {
    const now = new Date("2026-07-21T12:00:00Z");
    const tooFar = new Date(now.getTime() + 63 * 86_400_000).toISOString();
    const result = validateExtractedEvent({ title: "Later workshop", startsAt: tooFar, sourceUrl: "https://example.edu/events/later", evidence: ["Later workshop on the event page"] }, "https://example.edu/events/later", defaultProfile, now);
    expect(result.event).toBeNull();
    expect(result.reason).toContain("more than 62 days away");
  });

  it("rejects a physical event outside the selected travel radius", () => {
    const profile = { ...defaultProfile, travelRadius: 5, latitude: 41.8781, longitude: -87.6298 };
    const result = validateExtractedEvent({ title: "Regional AI workshop", startsAt: future, sourceUrl: "https://example.edu/events/regional-ai", format: "in-person", latitude: 42.3314, longitude: -83.0458, category: "Workshop", tags: ["AI"], extractionConfidence: 0.9, evidence: ["Regional AI workshop on the event page"], provenance: { extractionMethod: "structured" } }, "https://example.edu/events/regional-ai", profile);
    expect(result.event).toBeNull();
    expect(result.reason).toContain("outside your 5-mile travel area");
  });

  it("projects source provenance without raw page text", () => {
    const record = toProvenanceRecord(webEvent());
    expect(record).toMatchObject({ source_domain: "example.edu", extraction_method: "structured", discovery_query: "AI events Chicago" });
    expect(Object.keys(record ?? {})).not.toContain("raw_page_text");
  });

  it("deduplicates a web-discovered event against a matching nearby source", () => {
    const first = webEvent();
    const duplicate = webEvent({ id: "web-2", title: "AI Education Build Night!", source: "another source", url: "https://calendar.example.org/build-night", latitude: 41.881, longitude: -87.631 });
    const unique = webEvent({ id: "web-3", title: "AI Education Build Night", url: "https://calendar.example.org/different-day", startsAt: new Date(Date.now() + 86_400_000 * 11).toISOString() });
    const result = deduplicate([first, duplicate, unique]);
    expect(result.events).toHaveLength(2);
    expect(result.decisions[0]).toContain("title match");
  });
});
