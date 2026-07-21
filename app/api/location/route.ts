import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type NominatimResult = { lat?: string; lon?: string; display_name?: string };
const recentLookups = new Map<string, number>();

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { location?: unknown } | null;
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  if (location.length < 2 || location.length > 180) return NextResponse.json({ error: "Enter a city, ZIP code, or address first." }, { status: 400 });
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now(); const previous = recentLookups.get(client) ?? 0;
  if (now - previous < 1100) return NextResponse.json({ error: "Please wait a moment before trying another location." }, { status: 429 });
  recentLookups.set(client, now);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location); url.searchParams.set("format", "jsonv2"); url.searchParams.set("limit", "1");
  const country = process.env.MEET_LOCATION_COUNTRY_CODE?.trim(); if (country) url.searchParams.set("countrycodes", country);
  try {
    const response = await fetch(url, { headers: { "User-Agent": process.env.WEB_DISCOVERY_USER_AGENT || "MEETOpportunityBot/1.0 (+https://your-domain.example/bot)", Accept: "application/json" }, signal: AbortSignal.timeout(7000), cache: "no-store" });
    if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);
    const result = (await response.json() as NominatimResult[])[0]; const latitude = Number(result?.lat); const longitude = Number(result?.lon);
    if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return NextResponse.json({ error: "We couldn't find that location. Try a fuller address or ZIP code." }, { status: 404 });
    return NextResponse.json({ latitude, longitude, label: result.display_name ?? location });
  } catch { return NextResponse.json({ error: "Location lookup is unavailable right now. You can still use your current location." }, { status: 502 }); }
}
