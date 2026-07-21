import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type NominatimResult = { lat?: string; lon?: string; display_name?: string };
const recentLookups = new Map<string, number>();

function clientKey(request: NextRequest) { return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"; }
function claimLookup(request: NextRequest) {
  const client = clientKey(request); const now = Date.now(); const previous = recentLookups.get(client) ?? 0;
  if (now - previous < 350) return false;
  recentLookups.set(client, now); return true;
}
function searchUrl(location: string) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location); url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", "5"); url.searchParams.set("addressdetails", "1");
  const country = process.env.MEET_LOCATION_COUNTRY_CODE?.trim(); if (country) url.searchParams.set("countrycodes", country);
  return url;
}

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (location.length < 3) return NextResponse.json({ options: [] });
  if (!claimLookup(request)) return NextResponse.json({ options: [] });
  try {
    const response = await fetch(searchUrl(location), { headers: { "User-Agent": process.env.WEB_DISCOVERY_USER_AGENT || "MEETOpportunityBot/1.0 (+https://your-domain.example/bot)", Accept: "application/json" }, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error();
    const results = await response.json() as NominatimResult[];
    return NextResponse.json({ options: results.flatMap((result) => { const latitude = Number(result.lat); const longitude = Number(result.lon); return result.display_name && Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ label: result.display_name, latitude, longitude }] : []; }) });
  } catch { return NextResponse.json({ options: [] }); }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { location?: unknown; latitude?: unknown; longitude?: unknown } | null;
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const latitude = Number(body?.latitude); const longitude = Number(body?.longitude);
  const reverse = Number.isFinite(latitude) && Number.isFinite(longitude);
  if (!reverse && (location.length < 2 || location.length > 180)) return NextResponse.json({ error: "Choose a location first." }, { status: 400 });
  if (!claimLookup(request)) return NextResponse.json({ error: "Please wait a moment before trying another location." }, { status: 429 });
  const url = reverse ? new URL("https://nominatim.openstreetmap.org/reverse") : searchUrl(location);
  if (reverse) { url.searchParams.set("lat", String(latitude)); url.searchParams.set("lon", String(longitude)); url.searchParams.set("zoom", "10"); }
  else { url.searchParams.set("limit", "1"); }
  url.searchParams.set("format", "jsonv2");
  try {
    const response = await fetch(url, { headers: { "User-Agent": process.env.WEB_DISCOVERY_USER_AGENT || "MEETOpportunityBot/1.0 (+https://your-domain.example/bot)", Accept: "application/json" }, signal: AbortSignal.timeout(7000), cache: "no-store" });
    if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);
    const payload = await response.json() as NominatimResult[] | NominatimResult;
    const result = Array.isArray(payload) ? payload[0] : payload; const resolvedLatitude = Number(result?.lat); const resolvedLongitude = Number(result?.lon);
    if (!result || !Number.isFinite(resolvedLatitude) || !Number.isFinite(resolvedLongitude)) return NextResponse.json({ error: "We couldn't find that location. Try another option." }, { status: 404 });
    return NextResponse.json({ latitude: resolvedLatitude, longitude: resolvedLongitude, label: result.display_name ?? location });
  } catch { return NextResponse.json({ error: "Location lookup is unavailable right now. You can still use your current location." }, { status: 502 }); }
}
