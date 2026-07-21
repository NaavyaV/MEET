import { haversineMiles } from "./web-discovery";
import { createSupabaseAdminClient } from "./supabase";
import { Opportunity, UserProfile } from "./types";

const MAX_GEOCODES_PER_REFRESH = 10;
const NOMINATIM_INTERVAL_MS = 1_050;
const CACHE_TTL_DAYS = 90;

type CachedLocation = { location_key: string; latitude: number | string; longitude: number | string };
type NominatimResult = { lat?: string; lon?: string };

function hasProfileCoordinates(profile: UserProfile) {
  return Number.isFinite(profile.latitude) && Number.isFinite(profile.longitude) && (Math.abs(profile.latitude) > 0.001 || Math.abs(profile.longitude) > 0.001);
}

function hasCoordinates(event: Opportunity) {
  return Number.isFinite(event.latitude) && Number.isFinite(event.longitude);
}

function cleanLocation(value: string) {
  return value
    .replace(/\bPostalAddress\b/gi, "")
    .replace(/,?\s*(?:suite|ste|unit|floor|fl|room|rm)\.?\s*[a-z0-9-]+(?=,|$)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,+/g, ",")
    .trim();
}

function locationQuery(event: Opportunity, profile: UserProfile) {
  const place = cleanLocation(event.address || event.venue || "");
  if (place.length < 4) return null;
  return event.address ? place : `${place}, ${profile.location}`.replace(/\s*,\s*,+/g, ",").trim();
}

function locationKey(query: string) {
  return query.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 300);
}

function coordinate(value: string | number | undefined) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadCachedLocations(keys: string[]) {
  const admin = createSupabaseAdminClient();
  if (!admin || !keys.length) return new Map<string, { latitude: number; longitude: number }>();
  const { data } = await admin
    .from("event_location_cache")
    .select("location_key, latitude, longitude")
    .in("location_key", keys)
    .gt("expires_at", new Date().toISOString());
  return new Map((data as CachedLocation[] ?? []).flatMap((row) => {
    const latitude = coordinate(row.latitude); const longitude = coordinate(row.longitude);
    return latitude == null || longitude == null ? [] : [[row.location_key, { latitude, longitude }] as const];
  }));
}

async function saveCachedLocation(key: string, query: string, latitude: number, longitude: number) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin.from("event_location_cache").upsert({
    location_key: key,
    query_text: query,
    latitude,
    longitude,
    provider: "nominatim",
    verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CACHE_TTL_DAYS * 86_400_000).toISOString(),
  }, { onConflict: "location_key" });
}

async function geocode(query: string) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);
  const countryCode = process.env.MEET_LOCATION_COUNTRY_CODE?.trim();
  if (countryCode) url.searchParams.set("countrycodes", countryCode.toLowerCase());
  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.WEB_DISCOVERY_USER_AGENT || "MEETOpportunityBot/1.0 (+https://meet.example.com/bot)",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) return null;
  const result = (await response.json() as NominatimResult[])[0];
  const latitude = coordinate(result?.lat); const longitude = coordinate(result?.lon);
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

/**
 * Verify a bounded number of public venue/address strings after source
 * extraction. No physical event becomes eligible until it has coordinates.
 */
export async function verifyEventLocations(events: Opportunity[], profile: UserProfile) {
  if (!hasProfileCoordinates(profile)) return events;
  const candidates = events
    .filter((event) => event.format !== "online" && !hasCoordinates(event))
    .map((event) => ({ event, query: locationQuery(event, profile) }))
    .filter((entry): entry is { event: Opportunity; query: string } => Boolean(entry.query))
    .slice(0, MAX_GEOCODES_PER_REFRESH);
  if (!candidates.length) return events;

  const cached = await loadCachedLocations([...new Set(candidates.map((entry) => locationKey(entry.query)))]).catch(() => new Map<string, { latitude: number; longitude: number }>());
  const resolved = new Map<string, { latitude: number; longitude: number }>(cached);
  let lastRequestAt = 0;

  for (const entry of candidates) {
    const key = locationKey(entry.query);
    if (resolved.has(key)) continue;
    const wait = NOMINATIM_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const found = await geocode(entry.query).catch(() => null);
    if (!found) continue;
    resolved.set(key, found);
    void saveCachedLocation(key, entry.query, found.latitude, found.longitude);
  }

  return events.map((event) => {
    if (event.format === "online" || hasCoordinates(event)) return event;
    const query = locationQuery(event, profile); const found = query ? resolved.get(locationKey(query)) : undefined;
    return found ? { ...event, latitude: found.latitude, longitude: found.longitude, distanceMiles: haversineMiles(profile.latitude, profile.longitude, found.latitude, found.longitude) } : event;
  });
}
