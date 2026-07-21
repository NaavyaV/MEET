import { NextRequest, NextResponse } from "next/server";
import { profileFromDatabase, reserveRefreshQuota } from "@/src/lib/persistence";
import { runRefreshPipeline } from "@/src/lib/refresh-pipeline";
import { createSupabaseAdminClient } from "@/src/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createSupabaseAdminClient(); if (!admin) return NextResponse.json({ error: "Supabase server credentials are not configured." }, { status: 503 });
  const { data: profiles, error } = await admin.from("profiles").select("id, digest_email, full_name, skills, interests, career_stage, goals, location_label, latitude, longitude, travel_radius_miles, format_preference, availability, weights").in("digest_frequency", ["daily", "weekly"]).limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const completed = await Promise.allSettled((profiles ?? []).map(async (profile) => {
    const quota = await reserveRefreshQuota({ id: profile.id, email: profile.digest_email });
    if (quota && !quota.allowed) return "skipped";
    await runRefreshPipeline(profileFromDatabase(profile), profile.id);
    return "refreshed";
  }));
  return NextResponse.json({ processed: profiles?.length ?? 0, successful: completed.filter((result) => result.status === "fulfilled" && result.value === "refreshed").length, skipped: completed.filter((result) => result.status === "fulfilled" && result.value === "skipped").length, failed: completed.filter((result) => result.status === "rejected").length });
}
